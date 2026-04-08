import { eq } from 'drizzle-orm';
import { agentRegistry } from '@/lib/db/schema';
import { runBlueprint } from './blueprint-runner';
import { getAgentDb, type AgentDb } from './db';
import { startHeartbeat } from './heartbeat';
import {
  claimNextQueuedJob,
  completeJob,
  failJob,
  heartbeatJob,
  scheduleJobRetry,
} from './queue';
import type {
  AgentConfig,
  AgentJob,
  Blueprint,
  QueueClaimResult,
  WorkerConfig,
} from './types';

const DEFAULT_FAILURE_REASON = 'Unknown blueprint failure';
const JOB_LEASE_HEARTBEAT_INTERVAL_MS = 60_000;

export interface WorkerHandle {
  stop: () => Promise<void>;
}

function createSleepController() {
  let activeWake: (() => void) | null = null;

  return {
    sleep(ms: number) {
      return new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (activeWake === wake) {
            activeWake = null;
          }
          resolve();
        }, ms);

        const wake = () => {
          clearTimeout(timer);
          if (activeWake === wake) {
            activeWake = null;
          }
          resolve();
        };

        activeWake = wake;
      });
    },
    wake() {
      if (activeWake) {
        const wake = activeWake;
        activeWake = null;
        wake();
      }
    },
  };
}

function calculateBackoffMs(attempt: number) {
  return Math.pow(4, attempt - 1) * 2000;
}

function packageCompletedResult(job: AgentJob, finalOutput: unknown) {
  if (
    job.agentId === 'orchestrator'
    && job.jobType === 'chat'
    && finalOutput
    && typeof finalOutput === 'object'
    && (finalOutput as { decision?: unknown }).decision === 'route-to-specialist'
  ) {
    return {
      routed: true,
      specialistJobId: (finalOutput as { specialistJobId?: unknown }).specialistJobId ?? null,
    };
  }

  return finalOutput;
}

function formatWorkerFailure(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return DEFAULT_FAILURE_REASON;
}

async function applyLeaseFencedFinalizer(
  label: string,
  mutation: Promise<boolean>,
  jobId: string,
  workerId: string,
  leaseVersion: number,
) {
  const succeeded = await mutation;

  if (!succeeded) {
    console.error(`agent worker ${label} lost lease for job ${jobId}`, {
      jobId,
      workerId,
      leaseVersion,
    });
  }

  return succeeded;
}

function startJobLeaseHeartbeat(
  db: AgentDb,
  jobId: string,
  workerId: string,
  leaseVersion: number,
  intervalMs = JOB_LEASE_HEARTBEAT_INTERVAL_MS,
) {
  let inFlightHeartbeat: Promise<void> | null = null;

  const runHeartbeat = () => {
    if (inFlightHeartbeat) {
      return inFlightHeartbeat;
    }

    const promise = heartbeatJob(db, jobId, workerId, leaseVersion)
      .then((renewed) => {
        if (!renewed) {
          console.error(`agent worker heartbeatJob lost lease for job ${jobId}`, {
            jobId,
            workerId,
            leaseVersion,
          });
        }
      })
      .catch((error) => {
        console.error(`agent worker heartbeatJob failed for job ${jobId}`, {
          jobId,
          workerId,
          leaseVersion,
          error,
        });
      })
      .finally(() => {
        if (inFlightHeartbeat === promise) {
          inFlightHeartbeat = null;
        }
      });

    inFlightHeartbeat = promise;
    return promise;
  };

  const timer = setInterval(() => {
    void runHeartbeat();
  }, intervalMs);

  return {
    stop: async () => {
      clearInterval(timer);
      if (inFlightHeartbeat) {
        await inFlightHeartbeat;
      }
    },
  };
}

async function processClaim(
  db: AgentDb,
  claim: QueueClaimResult,
  config: WorkerConfig & { agentConfig: AgentConfig },
  workerId: string,
) {
  const { job, leaseVersion } = claim;
  let blueprint: Blueprint;

  try {
    blueprint = config.agentConfig.blueprintResolver(job);
  } catch (error) {
    await applyLeaseFencedFinalizer(
      'failJob',
      failJob(
        db,
        job.id,
        workerId,
        leaseVersion,
        formatWorkerFailure(error),
      ),
      job.id,
      workerId,
      leaseVersion,
    );
    return;
  }

  const leaseHeartbeat = startJobLeaseHeartbeat(db, job.id, workerId, leaseVersion);
  let result: Awaited<ReturnType<typeof runBlueprint>>;

  try {
    result = await runBlueprint(
      blueprint,
      job,
      config.agentConfig,
      db,
      { lockedBy: workerId, leaseVersion },
    );
  } catch (error) {
    await leaseHeartbeat.stop();

    if (job.attempt < job.maxAttempts) {
      await applyLeaseFencedFinalizer(
        'scheduleJobRetry',
        scheduleJobRetry(
          db,
          job.id,
          workerId,
          leaseVersion,
          new Date(Date.now() + calculateBackoffMs(job.attempt)),
          formatWorkerFailure(error),
        ),
        job.id,
        workerId,
        leaseVersion,
      );
      return;
    }

    await applyLeaseFencedFinalizer(
      'failJob',
      failJob(
        db,
        job.id,
        workerId,
        leaseVersion,
        formatWorkerFailure(error),
      ),
      job.id,
      workerId,
      leaseVersion,
    );
    return;
  }

  await leaseHeartbeat.stop();

  try {
    if (result.status === 'completed') {
      const completed = await applyLeaseFencedFinalizer(
        'completeJob',
        completeJob(
          db,
          job.id,
          workerId,
          leaseVersion,
          packageCompletedResult(job, result.finalOutput),
        ),
        job.id,
        workerId,
        leaseVersion,
      );
      if (!completed) {
        return;
      }
      return;
    }

    if (result.failureClass === 'transient' && job.attempt < job.maxAttempts) {
      const rescheduled = await applyLeaseFencedFinalizer(
        'scheduleJobRetry',
        scheduleJobRetry(
          db,
          job.id,
          workerId,
          leaseVersion,
          new Date(Date.now() + calculateBackoffMs(job.attempt)),
          result.failureReason ?? DEFAULT_FAILURE_REASON,
        ),
        job.id,
        workerId,
        leaseVersion,
      );
      if (!rescheduled) {
        return;
      }
      return;
    }

    const failed = await applyLeaseFencedFinalizer(
      'failJob',
      failJob(
        db,
        job.id,
        workerId,
        leaseVersion,
        result.failureReason ?? DEFAULT_FAILURE_REASON,
      ),
      job.id,
      workerId,
      leaseVersion,
    );
    if (!failed) {
      return;
    }
  } catch (error) {
    await applyLeaseFencedFinalizer(
      'failJob',
      failJob(
        db,
        job.id,
        workerId,
        leaseVersion,
        formatWorkerFailure(error),
      ),
      job.id,
      workerId,
      leaseVersion,
    );
  }
}

export async function startWorker(
  config: WorkerConfig & { agentConfig: AgentConfig },
): Promise<WorkerHandle> {
  const db = getAgentDb();
  if (!db) {
    throw new Error('Database not configured');
  }

  await db.update(agentRegistry)
    .set({ status: 'online' })
    .where(eq(agentRegistry.id, config.agentId));

  const heartbeat = startHeartbeat(db, config.agentId);
  const workerId = `${config.agentId}:${process.pid}`;
  const sleepController = createSleepController();
  let shuttingDown = false;

  const loopPromise = (async () => {
    try {
      while (!shuttingDown) {
        let claim: QueueClaimResult | null;

        try {
          claim = await claimNextQueuedJob(db, config.agentId, workerId);
        } catch (error) {
          console.error(`agent worker claim failed for ${config.agentId}`, error);
          if (!shuttingDown) {
            await sleepController.sleep(config.pollIntervalMs);
          }
          continue;
        }

        if (!claim) {
          if (!shuttingDown) {
            await sleepController.sleep(config.pollIntervalMs);
          }
          continue;
        }

        await processClaim(db, claim, config, workerId);
      }
    } finally {
      await heartbeat.stop();
    }
  })();

  return {
    stop: async () => {
      shuttingDown = true;
      sleepController.wake();
      await loopPromise;
    },
  };
}

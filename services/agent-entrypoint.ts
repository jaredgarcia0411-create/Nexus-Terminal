import { AGENT_CONFIGS } from '../lib/agents/config';
import { getAgentDb } from '../lib/agents/db';
import { startIntradayCron, startMacroCron, type MacroCronHandle } from '../lib/agents/macro-cron';
import { startWorker, type WorkerHandle } from '../lib/agents/worker';
import type { AgentId } from '../lib/agents/types';

function logEvent(event: string, details: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ event, ...details }));
}

function logErrorEvent(event: string, details: Record<string, unknown> = {}) {
  console.error(JSON.stringify({ event, ...details }));
}

async function main() {
  const rawAgentId = process.env.AGENT_ID;
  if (!rawAgentId || !(rawAgentId in AGENT_CONFIGS)) {
    logErrorEvent('entrypoint.invalid_agent_id', { agentId: rawAgentId ?? null });
    process.exit(1);
  }

  const agentId = rawAgentId as AgentId;
  const db = getAgentDb();
  if (!db) {
    logErrorEvent('entrypoint.db_unavailable', { agentId });
    process.exit(1);
  }

  const pollIntervalMs = Number(process.env.AGENT_POLL_INTERVAL_MS ?? '5000') || 5000;

  let worker: WorkerHandle | null = null;
  let macroCron: MacroCronHandle | null = null;
  let intradayCron: MacroCronHandle | null = null;
  let shuttingDown = false;

  try {
    worker = await startWorker({
      agentId,
      pollIntervalMs,
      agentConfig: AGENT_CONFIGS[agentId],
    });
    if (agentId === 'orchestrator') {
      macroCron = startMacroCron(db);
      if (process.env.MACRO_INTRADAY_ENABLED === '1') {
        intradayCron = startIntradayCron(db);
      }
    }
  } catch (error) {
    logErrorEvent('entrypoint.startup_failed', {
      agentId,
      error: error instanceof Error ? error.message : 'startup_failed',
    });
    if (worker) {
      await worker.stop();
    }
    if (macroCron) {
      await macroCron.stop();
    }
    if (intradayCron) {
      await intradayCron.stop();
    }
    process.exit(1);
  }

  logEvent('entrypoint.started', { agentId, pollIntervalMs });

  const shutdown = async (signal: 'SIGINT' | 'SIGTERM') => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    // Stop the worker first so it stops claiming jobs before the cron exits.
    logEvent('entrypoint.shutdown_begin', { agentId, signal });

    try {
      await worker?.stop();
      if (macroCron) {
        await macroCron.stop();
      }
      if (intradayCron) {
        await intradayCron.stop();
      }
      logEvent('entrypoint.shutdown_complete', { agentId, signal });
      process.exit(0);
    } catch {
      logErrorEvent('entrypoint.shutdown_failed', { agentId, signal });
      process.exit(1);
    }
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

void main().catch((error) => {
  logErrorEvent('entrypoint.fatal', {
    error: error instanceof Error ? error.message : 'fatal_error',
  });
  process.exit(1);
});

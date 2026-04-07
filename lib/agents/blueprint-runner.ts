import { and, eq } from 'drizzle-orm';
import type { ZodSchema } from 'zod';
import { agentJobCheckpoints, agentStepEffects } from '@/lib/db/schema';
import { loadCheckpoint, recordStepEffect, saveCheckpoint } from './checkpoints';
import { buildContext } from './context';
import type { AgentDb } from './db';
import { persistStepLog } from './queue';
import {
  checkBudget,
  checkCircuitBreaker,
  checkRateLimit,
  recordLlmAttempt,
} from './runtime-limits';
import {
  BlueprintValidationError,
  BudgetExceededError,
  CircuitOpenError,
  RateLimitExceededError,
} from './types';
import type {
  AgentConfig,
  AgentJob,
  Blueprint,
  FailureClass,
  StepInput,
  StepLogEntry,
  StepResult,
  TokenTrackingEntry,
} from './types';

type EffectType = 'checkpoint-marker' | 'report-write' | 'discord-delivery' | 'memory-write';

export interface RunBlueprintOptions {
  signal?: AbortSignal;
  lockedBy: string;
  leaseVersion: number;
}

export interface RunBlueprintResult {
  status: 'completed' | 'failed';
  finalOutput: unknown;
  failureReason?: string;
  stepsExecuted: number;
}

function getSchema(schema: unknown): ZodSchema<unknown> | undefined {
  return schema as ZodSchema<unknown> | undefined;
}

function getStepIdempotencyKey(job: AgentJob, step: Blueprint['steps'][number]): string | null {
  void job;
  const rawKey = step.metadata.idempotencyKey?.trim();
  if (!step.metadata.sideEffect || !rawKey) {
    return null;
  }

  return rawKey;
}

function getEffectTypeFromKey(idempotencyKey: string): EffectType {
  return idempotencyKey.slice(idempotencyKey.lastIndexOf(':') + 1) as EffectType;
}

function formatFailureReason(error: unknown): string {
  if (error instanceof Error) {
    const errorName = error.name !== 'Error'
      ? error.name
      : error.constructor?.name;

    if (errorName && errorName !== 'Error') {
      return `${errorName}: ${error.message}`;
    }

    return error.message;
  }

  return 'Unknown blueprint failure';
}

function classifyFailure(error: unknown): FailureClass {
  if (error instanceof BudgetExceededError || error instanceof RateLimitExceededError) {
    return 'policy';
  }

  if (error instanceof CircuitOpenError) {
    return 'dependency';
  }

  if (error instanceof BlueprintValidationError) {
    return 'contract';
  }

  return 'transient';
}

function readNumericField(source: unknown, key: string): number | null {
  if (!source || typeof source !== 'object') {
    return null;
  }

  const value = (source as Record<string, unknown>)[key];
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null;
  }

  return value;
}

function readStringField(source: unknown, key: string): string | null {
  if (!source || typeof source !== 'object') {
    return null;
  }

  const value = (source as Record<string, unknown>)[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  return value;
}

function buildLlmTrackingEntry(
  job: AgentJob,
  config: AgentConfig,
  step: Blueprint['steps'][number],
  payload: unknown,
  success: boolean,
): TokenTrackingEntry {
  const artifacts = payload && typeof payload === 'object'
    ? (payload as { artifacts?: unknown }).artifacts
    : null;
  const metrics = payload && typeof payload === 'object'
    ? (payload as { metrics?: unknown }).metrics
    : null;
  const provenance = payload && typeof payload === 'object'
    ? (payload as { provenance?: unknown }).provenance
    : null;

  const inputTokens = readNumericField(artifacts, 'inputTokens')
    ?? readNumericField(artifacts, 'promptTokens')
    ?? 0;
  const outputTokens = readNumericField(artifacts, 'outputTokens')
    ?? readNumericField(artifacts, 'completionTokens')
    ?? 0;
  const totalTokens = readNumericField(metrics, 'tokensUsed') ?? (inputTokens + outputTokens);
  const durationMs = readNumericField(metrics, 'durationMs') ?? 0;
  const modelUsed = readStringField(provenance, 'model')
    ?? readStringField(artifacts, 'modelUsed')
    ?? config.modelOverride
    ?? 'unknown';

  return {
    userId: job.userId,
    agentId: job.agentId,
    mode: job.jobType,
    lane: step.metadata.lane ?? 'background',
    modelUsed,
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostCents: 0,
    durationMs,
    success,
  };
}

function validateStepPayload(
  step: Blueprint['steps'][number],
  location: 'input' | 'output',
  payload: unknown,
  schemaValue: unknown,
) {
  const schema = getSchema(schemaValue);
  if (!schema) {
    return;
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new BlueprintValidationError(step.name, location, parsed.error);
  }
}

class StepExecutionFailure extends Error {
  constructor(
    public cause: unknown,
    public tokensUsed: number,
  ) {
    super(cause instanceof Error ? cause.message : 'Step execution failed');
    this.name = 'StepExecutionFailure';
  }
}

function unwrapStepExecutionError(error: unknown): unknown {
  return error instanceof StepExecutionFailure ? error.cause : error;
}

function readFailedStepTokens(error: unknown): number | undefined {
  if (!(error instanceof StepExecutionFailure)) {
    return undefined;
  }

  return error.tokensUsed > 0 ? error.tokensUsed : undefined;
}

async function appendStepLog(
  db: AgentDb,
  job: AgentJob,
  options: RunBlueprintOptions,
  existing: StepLogEntry[],
  entry: StepLogEntry,
): Promise<StepLogEntry[] | null> {
  const nextStepLog = [...existing, entry];
  const persisted = await persistStepLog(
    db,
    job.id,
    options.lockedBy,
    options.leaseVersion,
    nextStepLog,
  );

  return persisted ? nextStepLog : null;
}

async function hasRecordedEffect(
  db: AgentDb,
  idempotencyKey: string,
): Promise<boolean> {
  // The spec requires skipping already-recorded side effects before calling step.run(),
  // so the runner needs a read path even though checkpoints.ts intentionally exposes
  // only the insert-once marker helper.
  const [row] = await db.select({
    id: agentStepEffects.id,
  })
    .from(agentStepEffects)
    .where(eq(agentStepEffects.idempotencyKey, idempotencyKey))
    .limit(1);

  return Boolean(row);
}

async function loadCheckpointForStep(
  db: AgentDb,
  jobId: string,
  stepIndex: number,
): Promise<unknown | undefined> {
  const [row] = await db.select({
    checkpointJson: agentJobCheckpoints.checkpointJson,
  })
    .from(agentJobCheckpoints)
    .where(and(
      eq(agentJobCheckpoints.jobId, jobId),
      eq(agentJobCheckpoints.stepIndex, stepIndex),
    ))
    .limit(1);

  return row?.checkpointJson;
}

async function runStepOnce(
  step: Blueprint['steps'][number],
  stepInput: StepInput,
  job: AgentJob,
  config: AgentConfig,
  db: AgentDb,
): Promise<{ result: StepResult; tokensUsed: number }> {
  try {
    const result = await step.run(stepInput);
    const tokensUsed = result.metrics.tokensUsed ?? 0;
    return { result, tokensUsed };
  } catch (error) {
    if (step.type === 'llm') {
      await recordLlmAttempt(db, buildLlmTrackingEntry(job, config, step, error, false));
    }

    throw error;
  }
}

async function executeStep(
  step: Blueprint['steps'][number],
  stepInput: StepInput,
  job: AgentJob,
  config: AgentConfig,
  db: AgentDb,
): Promise<{ result: StepResult; tokensUsed: number }> {
  let totalTokens = 0;

  try {
    const firstAttempt = await runStepOnce(step, stepInput, job, config, db);
    totalTokens = firstAttempt.tokensUsed;

    if (step.type !== 'llm') {
      validateStepPayload(step, 'output', firstAttempt.result.data, step.outputSchema);
      return firstAttempt;
    }

    try {
      validateStepPayload(step, 'output', firstAttempt.result.data, step.outputSchema);
      await recordLlmAttempt(db, buildLlmTrackingEntry(job, config, step, firstAttempt.result, true));
      return firstAttempt;
    } catch (error) {
      if (!(error instanceof BlueprintValidationError) || error.location !== 'output') {
        await recordLlmAttempt(db, buildLlmTrackingEntry(job, config, step, firstAttempt.result, false));
        throw error;
      }

      await recordLlmAttempt(db, buildLlmTrackingEntry(job, config, step, firstAttempt.result, false));

      const repairAttempt = await runStepOnce(step, stepInput, job, config, db);
      totalTokens += repairAttempt.tokensUsed;

      try {
        validateStepPayload(step, 'output', repairAttempt.result.data, step.outputSchema);
        await recordLlmAttempt(db, buildLlmTrackingEntry(job, config, step, repairAttempt.result, true));
        return {
          result: repairAttempt.result,
          tokensUsed: totalTokens,
        };
      } catch (repairError) {
        if (repairError instanceof BlueprintValidationError && repairError.location === 'output') {
          await recordLlmAttempt(db, buildLlmTrackingEntry(job, config, step, repairAttempt.result, false));
        }

        throw repairError;
      }
    }
  } catch (error) {
    if (error instanceof StepExecutionFailure) {
      throw error;
    }

    throw new StepExecutionFailure(error, totalTokens);
  }
}

export async function runBlueprint(
  blueprint: Blueprint,
  job: AgentJob,
  config: AgentConfig,
  db: AgentDb,
  options: RunBlueprintOptions,
): Promise<RunBlueprintResult> {
  const context = await buildContext(db, job.userId, job.agentId);
  const savedCheckpoint = await loadCheckpoint(db, job.id);
  let previousOutput: unknown | null = savedCheckpoint?.checkpointJson ?? null;
  let currentStepLog = [...job.stepLog];
  let stepsExecuted = 0;
  const startIndex = savedCheckpoint ? savedCheckpoint.stepIndex + 1 : 0;

  if (startIndex >= blueprint.steps.length) {
    return {
      status: 'completed',
      finalOutput: previousOutput,
      stepsExecuted: 0,
    };
  }

  for (let stepIndex = startIndex; stepIndex < blueprint.steps.length; stepIndex += 1) {
    const step = blueprint.steps[stepIndex];
    const startedAt = new Date().toISOString();
    const idempotencyKey = getStepIdempotencyKey(job, step);

    if (idempotencyKey && await hasRecordedEffect(db, idempotencyKey)) {
      const checkpointOutput = await loadCheckpointForStep(db, job.id, stepIndex);
      const completedAt = new Date().toISOString();
      const entry: StepLogEntry = {
        step: step.name,
        status: 'completed',
        startedAt,
        completedAt,
        attempt: job.attempt,
        validatorResult: 'pass',
        tokensUsed: 0,
        ...(checkpointOutput === undefined ? { errorClass: 'crash-between-effect-and-checkpoint' } : {}),
      };
      const persisted = await appendStepLog(db, job, options, currentStepLog, entry);
      if (!persisted) {
        return {
          status: 'failed',
          finalOutput: null,
          failureReason: 'lease lost during step_log persistence',
          stepsExecuted,
        };
      }

      currentStepLog = persisted;
      if (checkpointOutput !== undefined) {
        previousOutput = checkpointOutput;
      }
      continue;
    }

    try {
      if (options.signal?.aborted) {
        throw options.signal.reason instanceof Error
          ? options.signal.reason
          : new Error('Blueprint run aborted');
      }

      await checkBudget(db, job.userId, job.agentId);
      await checkRateLimit(db, job.userId, job.agentId);
      await checkCircuitBreaker(db, job.userId, job.agentId);

      validateStepPayload(
        step,
        'input',
        stepIndex === 0 ? job.input : previousOutput,
        step.inputSchema,
      );

      const stepInput: StepInput = {
        jobInput: job.input,
        previousOutput,
        memory: context.memory,
        context,
      };

      stepsExecuted += 1;
      const { result, tokensUsed } = await executeStep(step, stepInput, job, config, db);

      if (idempotencyKey) {
        const effectRecorded = await recordStepEffect(db, {
          jobId: job.id,
          stepName: step.name,
          effectType: getEffectTypeFromKey(idempotencyKey),
          idempotencyKey,
        });

        if (!effectRecorded) {
          const checkpointOutput = await loadCheckpointForStep(db, job.id, stepIndex);
          const completedAt = new Date().toISOString();
          const entry: StepLogEntry = {
            step: step.name,
            status: 'completed',
            startedAt,
            completedAt,
            attempt: job.attempt,
            validatorResult: 'pass',
            tokensUsed: 0,
            ...(checkpointOutput === undefined ? { errorClass: 'crash-between-effect-and-checkpoint' } : {}),
          };
          const persisted = await appendStepLog(db, job, options, currentStepLog, entry);
          if (!persisted) {
            return {
              status: 'failed',
              finalOutput: null,
              failureReason: 'lease lost during step_log persistence',
              stepsExecuted,
            };
          }

          currentStepLog = persisted;
          if (checkpointOutput !== undefined) {
            previousOutput = checkpointOutput;
          }
          continue;
        }
      }

      await saveCheckpoint(db, {
        jobId: job.id,
        stepIndex,
        stepName: step.name,
        checkpointJson: result.data,
      });

      const completedEntry: StepLogEntry = {
        step: step.name,
        status: 'completed',
        startedAt,
        completedAt: new Date().toISOString(),
        attempt: job.attempt,
        validatorResult: 'pass',
        tokensUsed,
      };
      const persisted = await appendStepLog(db, job, options, currentStepLog, completedEntry);
      if (!persisted) {
        return {
          status: 'failed',
          finalOutput: null,
          failureReason: 'lease lost during step_log persistence',
          stepsExecuted,
        };
      }

      currentStepLog = persisted;
      previousOutput = result.data;
    } catch (error) {
      const underlyingError = unwrapStepExecutionError(error);
      const failureClass = classifyFailure(underlyingError);
      const failedTokens = readFailedStepTokens(error);
      const failureEntry: StepLogEntry = {
        step: step.name,
        status: 'failed',
        startedAt,
        completedAt: new Date().toISOString(),
        attempt: job.attempt,
        ...(failureClass === 'contract' ? { validatorResult: 'fail' as const } : {}),
        ...(failedTokens === undefined ? {} : { tokensUsed: failedTokens }),
        errorClass: failureClass,
      };
      const persisted = await appendStepLog(db, job, options, currentStepLog, failureEntry);
      if (!persisted) {
        return {
          status: 'failed',
          finalOutput: null,
          failureReason: 'lease lost during step_log persistence',
          stepsExecuted,
        };
      }

      currentStepLog = persisted;
      return {
        status: 'failed',
        finalOutput: null,
        failureReason: formatFailureReason(underlyingError),
        stepsExecuted,
      };
    }
  }

  return {
    status: 'completed',
    finalOutput: previousOutput,
    stepsExecuted,
  };
}

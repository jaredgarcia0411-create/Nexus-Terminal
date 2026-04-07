import { describe, expect, it, vi } from 'vitest';
import {
  loadCheckpoint,
  recordStepEffect,
  saveCheckpoint,
} from '@/lib/agents/checkpoints';
import { agentJobCheckpoints, agentStepEffects } from '@/lib/db/schema';

function createDb({
  selectRows = [],
  returningRows = [{ id: 'effect-1' }],
}: {
  selectRows?: unknown[][];
  returningRows?: Array<{ id: string }>;
} = {}) {
  const state = {
    insertedValues: [] as unknown[],
    conflictUpdateArgs: [] as unknown[],
    conflictDoNothingArgs: [] as unknown[],
  };

  const limit = vi.fn(async (count: number) => {
    const rows = selectRows.shift() ?? [];
    return rows.slice(0, count);
  });
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ orderBy, limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  const returning = vi.fn(async () => returningRows);
  const onConflictDoNothing = vi.fn((args: unknown) => {
    state.conflictDoNothingArgs.push(args);
    return { returning };
  });
  const onConflictDoUpdate = vi.fn(async (args: unknown) => {
    state.conflictUpdateArgs.push(args);
  });
  const values = vi.fn((value: unknown) => {
    state.insertedValues.push(value);
    return {
      onConflictDoNothing,
      onConflictDoUpdate,
    };
  });
  const insert = vi.fn(() => ({ values }));

  return {
    select,
    insert,
    _state: state,
  };
}

describe('agent checkpoints', () => {
  it('loads the most recent checkpoint row for a job', async () => {
    const db = createDb({
      selectRows: [[{
        jobId: 'job-1',
        stepIndex: 2,
        stepName: 'second',
        checkpointJson: { done: true },
      }]],
    });

    await expect(loadCheckpoint(db as never, 'job-1')).resolves.toEqual({
      jobId: 'job-1',
      stepIndex: 2,
      stepName: 'second',
      checkpointJson: { done: true },
    });
  });

  it('returns null when no checkpoint exists for the job', async () => {
    const db = createDb({ selectRows: [[]] });

    await expect(loadCheckpoint(db as never, 'job-1')).resolves.toBeNull();
  });

  it('saves checkpoints with idempotent conflict updates on job and step index', async () => {
    const db = createDb();

    await saveCheckpoint(db as never, {
      jobId: 'job-1',
      stepIndex: 1,
      stepName: 'draft',
      checkpointJson: { ok: true },
    });

    expect(db._state.insertedValues[0]).toMatchObject({
      jobId: 'job-1',
      stepIndex: 1,
      stepName: 'draft',
      checkpointJson: { ok: true },
    });
    expect((db._state.insertedValues[0] as { id?: string }).id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(db._state.conflictUpdateArgs[0]).toMatchObject({
      target: [
        agentJobCheckpoints.jobId,
        agentJobCheckpoints.stepIndex,
      ],
      set: {
        stepName: 'draft',
        checkpointJson: { ok: true },
      },
    });
  });

  it('records a step effect once and returns false for duplicate idempotency keys', async () => {
    const insertedDb = createDb({ returningRows: [{ id: 'effect-1' }] });
    const duplicateDb = createDb({ returningRows: [] });

    await expect(recordStepEffect(insertedDb as never, {
      jobId: 'job-1',
      stepName: 'deliver',
      effectType: 'memory-write',
      idempotencyKey: 'job-1:deliver:memory-write',
    })).resolves.toBe(true);

    await expect(recordStepEffect(duplicateDb as never, {
      jobId: 'job-1',
      stepName: 'deliver',
      effectType: 'memory-write',
      idempotencyKey: 'job-1:deliver:memory-write',
    })).resolves.toBe(false);

    expect(insertedDb._state.conflictDoNothingArgs[0]).toMatchObject({
      target: agentStepEffects.idempotencyKey,
    });
  });
});

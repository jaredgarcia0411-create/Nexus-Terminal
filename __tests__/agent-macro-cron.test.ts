import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const randomUUIDMock = vi.hoisted(() => vi.fn());

vi.mock('node:crypto', () => ({
  randomUUID: randomUUIDMock,
}));

import { startMacroCron } from '@/lib/agents/macro-cron';
import type { AgentDb } from '@/lib/agents/db';

function createDb(executeResults: unknown[] = []) {
  const state = {
    insertedJobs: [] as Array<Record<string, unknown>>,
    updateValues: [] as Array<Record<string, unknown>>,
  };

  const execute = vi.fn(async () => executeResults.shift() ?? []);
  const insertValues = vi.fn(async (value: Record<string, unknown>) => {
    state.insertedJobs.push(value);
    return [value];
  });
  const insert = vi.fn(() => ({ values: insertValues }));
  const updateWhere = vi.fn(async () => []);
  const updateSet = vi.fn((value: Record<string, unknown>) => {
    state.updateValues.push(value);
    return { where: updateWhere };
  });
  const update = vi.fn(() => ({ set: updateSet }));

  return {
    execute,
    insert,
    update,
    _state: state,
  } as unknown as AgentDb & {
    _state: typeof state;
  };
}

describe('startMacroCron', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    randomUUIDMock.mockReset()
      .mockReturnValueOnce('scheduled-run-row')
      .mockReturnValueOnce('macro-job-1')
      .mockReturnValue('extra-id');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips ticks that are outside the configured America/New_York trigger hour', async () => {
    vi.setSystemTime(new Date('2026-04-07T09:00:00.000Z'));
    const db = createDb();
    const handle = startMacroCron(db, { hourEt: 6, checkIntervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(db.execute).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();

    await handle.stop();
  });

  it('claims the scheduled run, enqueues one macro-summary job, and marks the run completed', async () => {
    vi.setSystemTime(new Date('2026-04-07T10:00:00.000Z'));
    const db = createDb([[{ id: 'scheduled-run-row' }]]);
    const handle = startMacroCron(db, { hourEt: 6, checkIntervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db._state.insertedJobs).toEqual([{
      id: 'macro-job-1',
      agentId: 'orchestrator',
      userId: 'system-agent-user',
      jobType: 'macro-summary',
      status: 'queued',
      input: { tradingDate: '2026-04-07' },
    }]);
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db._state.updateValues).toEqual([{
      jobId: 'macro-job-1',
      status: 'completed',
      completedAt: expect.any(Object),
    }]);

    await handle.stop();
  });

  it('dedupes concurrent ticks by skipping job creation when the on-conflict insert returns no row', async () => {
    vi.setSystemTime(new Date('2026-04-07T10:00:00.000Z'));
    const db = createDb([
      [{ id: 'scheduled-run-row' }],
      [],
    ]);
    const handle = startMacroCron(db, { hourEt: 6, checkIntervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(db.execute).toHaveBeenCalledTimes(2);
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.update).toHaveBeenCalledTimes(1);

    await handle.stop();
  });
});

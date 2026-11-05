import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const randomUUIDMock = vi.hoisted(() => vi.fn());

vi.mock('node:crypto', () => ({
  randomUUID: randomUUIDMock,
}));

import { startIntradayCron, startMacroCron, startParabolicCron, startTripleBeatCron } from '@/lib/agents/macro-cron';
import type { AgentDb } from '@/lib/agents/db';

type TxFailurePlan = Record<number, 'insert' | 'update'>;

function createDb(executeResults: unknown[] = [], failurePlan: TxFailurePlan = {}) {
  const state = {
    transactionCalls: 0,
    insertedJobs: [] as Array<Record<string, unknown>>,
    updateValues: [] as Array<Record<string, unknown>>,
    executeQueries: [] as unknown[],
  };

  const execute = vi.fn(async (query: unknown) => {
    state.executeQueries.push(query);
    return executeResults.shift() ?? [];
  });
  const transaction = vi.fn(async (callback: (tx: {
    execute: typeof execute;
    insert: (table: unknown) => { values: (value: Record<string, unknown>) => Promise<unknown[]> };
    update: (table: unknown) => { set: (value: Record<string, unknown>) => { where: (predicate: unknown) => Promise<unknown[]> } };
  }) => Promise<unknown>) => {
    state.transactionCalls += 1;
    const callNumber = state.transactionCalls;
    const txState = {
      insertedJobs: [] as Array<Record<string, unknown>>,
      updateValues: [] as Array<Record<string, unknown>>,
    };
    const failureStage = failurePlan[callNumber];

    const tx = {
      execute,
      insert: vi.fn(() => ({
        values: async (value: Record<string, unknown>) => {
          if (failureStage === 'insert') {
            throw new Error('macro cron insert failed');
          }
          txState.insertedJobs.push(value);
          return [value];
        },
      })),
      update: vi.fn(() => ({
        set: vi.fn((value: Record<string, unknown>) => {
          const updateWhere = async () => {
            if (failureStage === 'update') {
              throw new Error('macro cron update failed');
            }
            txState.updateValues.push(value);
            return [];
          };

          return { where: updateWhere };
        }),
      })),
    };

    const result = await callback(tx);
    state.insertedJobs.push(...txState.insertedJobs);
    state.updateValues.push(...txState.updateValues);
    return result;
  });
  const insert = vi.fn(() => ({ values: vi.fn(async () => []) }));
  const update = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => []) })) }));

  return {
    execute,
    transaction,
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
      .mockReturnValueOnce('scheduled-run-row-2')
      .mockReturnValueOnce('macro-job-2')
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
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();

    await handle.stop();
  });

  it('skips weekend ticks even when the trigger hour matches', async () => {
    // 2026-04-11 is a Saturday. 10:00 UTC = 06:00 ET, matching the trigger hour.
    vi.setSystemTime(new Date('2026-04-11T10:00:00.000Z'));
    const db = createDb([[{ id: 'scheduled-run-row' }]]);
    const handle = startMacroCron(db, { hourEt: 6, checkIntervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(0);

    expect(db.execute).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();

    await handle.stop();
  });

  it('skips NYSE holiday ticks even when the trigger hour matches', async () => {
    // 2026-11-26 is Thanksgiving (Thursday). 11:00 UTC = 06:00 EST, matching the trigger hour.
    vi.setSystemTime(new Date('2026-11-26T11:00:00.000Z'));
    const db = createDb([[{ id: 'scheduled-run-row' }]]);
    const handle = startMacroCron(db, { hourEt: 6, checkIntervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(0);

    expect(db.execute).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();

    await handle.stop();
  });

  it.each([
    // Friday before the spring-forward weekend: 06:00 EST is 11:00 UTC.
    ['2026-03-06T11:00:00.000Z', '2026-03-06'],
    // Monday after: 06:00 EDT is 10:00 UTC.
    ['2026-03-09T10:00:00.000Z', '2026-03-09'],
    // Friday before the fall-back weekend: 06:00 EDT.
    ['2026-10-30T10:00:00.000Z', '2026-10-30'],
    // Monday after: 06:00 EST.
    ['2026-11-02T11:00:00.000Z', '2026-11-02'],
  ])('fires at 06:00 Eastern on %s regardless of the UTC offset', async (nowIso, tradingDate) => {
    vi.setSystemTime(new Date(nowIso));
    const db = createDb([[{ id: 'scheduled-run-row' }]]);
    const handle = startMacroCron(db, { hourEt: 6, checkIntervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(0);

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db._state.insertedJobs[0]?.input).toEqual({ tradingDate });

    await handle.stop();
  });

  it.each([
    // 11:00 UTC is 07:00 EDT once clocks have sprung forward.
    ['2026-03-09T11:00:00.000Z'],
    // 10:00 UTC is 05:00 EST once clocks have fallen back.
    ['2026-11-02T10:00:00.000Z'],
  ])('does not fire at the stale UTC hour after a DST change (%s)', async (nowIso) => {
    vi.setSystemTime(new Date(nowIso));
    const db = createDb([[{ id: 'scheduled-run-row' }]]);
    const handle = startMacroCron(db, { hourEt: 6, checkIntervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(0);

    expect(db.transaction).not.toHaveBeenCalled();

    await handle.stop();
  });

  it('claims the scheduled run, enqueues one macro-summary job, and marks the run completed', async () => {
    vi.setSystemTime(new Date('2026-04-07T10:00:00.000Z'));
    const db = createDb([[{ id: 'scheduled-run-row' }]]);
    const handle = startMacroCron(db, { hourEt: 6, checkIntervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(0);

    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db._state.insertedJobs).toEqual([{
      id: 'macro-job-1',
      agentId: 'orchestrator',
      userId: 'system-agent-user',
      jobType: 'macro-summary',
      status: 'queued',
      input: { tradingDate: '2026-04-07' },
    }]);
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

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(db.execute).toHaveBeenCalledTimes(2);
    expect(db.transaction).toHaveBeenCalledTimes(2);
    expect(db._state.insertedJobs).toHaveLength(1);
    expect(db._state.updateValues).toHaveLength(1);

    await handle.stop();
  });

  it('rolls back a failed job insert so a later tick can claim again', async () => {
    vi.setSystemTime(new Date('2026-04-07T10:00:00.000Z'));
    randomUUIDMock.mockReset()
      .mockReturnValueOnce('scheduled-run-row-1')
      .mockReturnValueOnce('macro-job-1')
      .mockReturnValueOnce('scheduled-run-row-2')
      .mockReturnValueOnce('macro-job-2')
      .mockReturnValue('extra-id');
    const db = createDb([
      [{ id: 'scheduled-run-row-1' }],
      [{ id: 'scheduled-run-row-2' }],
    ], {
      1: 'insert',
    });
    const handle = startMacroCron(db, { hourEt: 6, checkIntervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(db.execute).toHaveBeenCalledTimes(2);
    expect(db.transaction).toHaveBeenCalledTimes(2);
    expect(db._state.insertedJobs).toEqual([{
      id: 'macro-job-2',
      agentId: 'orchestrator',
      userId: 'system-agent-user',
      jobType: 'macro-summary',
      status: 'queued',
      input: { tradingDate: '2026-04-07' },
    }]);
    expect(db._state.updateValues).toEqual([{
      jobId: 'macro-job-2',
      status: 'completed',
      completedAt: expect.any(Object),
    }]);

    await handle.stop();
  });

  it('rolls back a failed completion update so a later tick can claim again', async () => {
    vi.setSystemTime(new Date('2026-04-07T10:00:00.000Z'));
    randomUUIDMock.mockReset()
      .mockReturnValueOnce('scheduled-run-row-1')
      .mockReturnValueOnce('macro-job-1')
      .mockReturnValueOnce('scheduled-run-row-2')
      .mockReturnValueOnce('macro-job-2')
      .mockReturnValue('extra-id');
    const db = createDb([
      [{ id: 'scheduled-run-row-1' }],
      [{ id: 'scheduled-run-row-2' }],
    ], {
      1: 'update',
    });
    const handle = startMacroCron(db, { hourEt: 6, checkIntervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(db.execute).toHaveBeenCalledTimes(2);
    expect(db.transaction).toHaveBeenCalledTimes(2);
    expect(db._state.insertedJobs).toEqual([{
      id: 'macro-job-2',
      agentId: 'orchestrator',
      userId: 'system-agent-user',
      jobType: 'macro-summary',
      status: 'queued',
      input: { tradingDate: '2026-04-07' },
    }]);
    expect(db._state.updateValues).toEqual([{
      jobId: 'macro-job-2',
      status: 'completed',
      completedAt: expect.any(Object),
    }]);

    await handle.stop();
  });
});

describe('startIntradayCron', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    randomUUIDMock.mockReset()
      .mockReturnValueOnce('scheduled-run-row')
      .mockReturnValueOnce('macro-job-1')
      .mockReturnValueOnce('scheduled-run-row-2')
      .mockReturnValueOnce('macro-job-2')
      .mockReturnValue('extra-id');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips ticks that are outside the configured America/New_York trigger hour', async () => {
    vi.setSystemTime(new Date('2026-04-07T15:00:00.000Z'));
    const db = createDb();
    const handle = startIntradayCron(db, { hourEt: 12, checkIntervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(db.execute).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();

    await handle.stop();
  });

  it('skips weekend ticks even when the trigger hour matches', async () => {
    // 2026-04-12 is a Sunday. 16:00 UTC = 12:00 ET, matching the intraday trigger hour.
    vi.setSystemTime(new Date('2026-04-12T16:00:00.000Z'));
    const db = createDb([[{ id: 'scheduled-run-row' }]]);
    const handle = startIntradayCron(db, { hourEt: 12, checkIntervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(0);

    expect(db.execute).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();

    await handle.stop();
  });

  it('claims the scheduled run, enqueues one macro-summary job with intradayUpdate, and marks the run completed', async () => {
    vi.setSystemTime(new Date('2026-04-07T16:00:00.000Z'));
    const db = createDb([[{ id: 'scheduled-run-row' }]]);
    const handle = startIntradayCron(db, { hourEt: 12, checkIntervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(0);

    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(db._state.executeQueries[0])).toContain('macro-intraday');
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db._state.insertedJobs).toEqual([{
      id: 'macro-job-1',
      agentId: 'orchestrator',
      userId: 'system-agent-user',
      jobType: 'macro-summary',
      status: 'queued',
      input: { tradingDate: '2026-04-07', intradayUpdate: true },
    }]);
    expect(db._state.updateValues).toEqual([{
      jobId: 'macro-job-1',
      status: 'completed',
      completedAt: expect.any(Object),
    }]);

    await handle.stop();
  });

  it('dedupes concurrent ticks by skipping job creation when the on-conflict insert returns no row', async () => {
    vi.setSystemTime(new Date('2026-04-07T16:00:00.000Z'));
    const db = createDb([
      [{ id: 'scheduled-run-row' }],
      [],
    ]);
    const handle = startIntradayCron(db, { hourEt: 12, checkIntervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(db.execute).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(db._state.executeQueries[0])).toContain('macro-intraday');
    expect(db.transaction).toHaveBeenCalledTimes(2);
    expect(db._state.insertedJobs).toHaveLength(1);
    expect(db._state.updateValues).toHaveLength(1);

    await handle.stop();
  });
});

describe('startParabolicCron', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    randomUUIDMock.mockReset()
      .mockReturnValueOnce('scheduled-run-row')
      .mockReturnValueOnce('macro-job-1')
      .mockReturnValueOnce('scheduled-run-row-2')
      .mockReturnValueOnce('macro-job-2')
      .mockReturnValue('extra-id');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips ticks that are outside the configured America/New_York trigger hour', async () => {
    vi.setSystemTime(new Date('2026-04-07T12:00:00.000Z'));
    const db = createDb();
    const handle = startParabolicCron(db, { hourEt: 9, checkIntervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(db.execute).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();

    await handle.stop();
  });

  it('skips weekend ticks even when the trigger hour matches', async () => {
    // 2026-04-12 is a Sunday. 13:00 UTC = 09:00 ET, matching the parabolic trigger hour.
    vi.setSystemTime(new Date('2026-04-12T13:00:00.000Z'));
    const db = createDb([[{ id: 'scheduled-run-row' }]]);
    const handle = startParabolicCron(db, { hourEt: 9, checkIntervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(0);

    expect(db.execute).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();

    await handle.stop();
  });

  it('claims the scheduled run, enqueues one parabolic-scan job, and marks the run completed', async () => {
    vi.setSystemTime(new Date('2026-04-07T13:00:00.000Z'));
    const db = createDb([[{ id: 'scheduled-run-row' }]]);
    const handle = startParabolicCron(db, { hourEt: 9, checkIntervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(0);

    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(db._state.executeQueries[0])).toContain('parabolic-scan');
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db._state.insertedJobs).toEqual([{
      id: 'macro-job-1',
      agentId: 'orchestrator',
      userId: 'system-agent-user',
      jobType: 'parabolic-scan',
      status: 'queued',
      input: { tradingDate: '2026-04-07' },
    }]);
    expect(db._state.updateValues).toEqual([{
      jobId: 'macro-job-1',
      status: 'completed',
      completedAt: expect.any(Object),
    }]);

    await handle.stop();
  });

  it('dedupes concurrent ticks by skipping job creation when the on-conflict insert returns no row', async () => {
    vi.setSystemTime(new Date('2026-04-07T13:00:00.000Z'));
    const db = createDb([
      [{ id: 'scheduled-run-row' }],
      [],
    ]);
    const handle = startParabolicCron(db, { hourEt: 9, checkIntervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(db.execute).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(db._state.executeQueries[0])).toContain('parabolic-scan');
    expect(db.transaction).toHaveBeenCalledTimes(2);
    expect(db._state.insertedJobs).toHaveLength(1);
    expect(db._state.updateValues).toHaveLength(1);

    await handle.stop();
  });
});

describe('startTripleBeatCron', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    randomUUIDMock.mockReset()
      .mockReturnValueOnce('scheduled-run-row')
      .mockReturnValueOnce('macro-job-1')
      .mockReturnValueOnce('scheduled-run-row-2')
      .mockReturnValueOnce('macro-job-2')
      .mockReturnValue('extra-id');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips ticks that are outside the configured America/New_York trigger hour', async () => {
    vi.setSystemTime(new Date('2026-04-07T12:00:00.000Z'));
    const db = createDb();
    const handle = startTripleBeatCron(db, { hourEt: 9, checkIntervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(db.execute).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();

    await handle.stop();
  });

  it('skips weekend ticks even when the trigger hour matches', async () => {
    // 2026-04-12 is a Sunday. 13:00 UTC = 09:00 ET, matching the triple beat trigger hour.
    vi.setSystemTime(new Date('2026-04-12T13:00:00.000Z'));
    const db = createDb([[{ id: 'scheduled-run-row' }]]);
    const handle = startTripleBeatCron(db, { hourEt: 9, checkIntervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(0);

    expect(db.execute).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();

    await handle.stop();
  });

  it('claims the scheduled run, enqueues one triple-beat-scan job, and marks the run completed', async () => {
    vi.setSystemTime(new Date('2026-04-07T13:00:00.000Z'));
    const db = createDb([[{ id: 'scheduled-run-row' }]]);
    const handle = startTripleBeatCron(db, { hourEt: 9, checkIntervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(0);

    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(db._state.executeQueries[0])).toContain('triple-beat-scan');
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db._state.insertedJobs).toEqual([{
      id: 'macro-job-1',
      agentId: 'orchestrator',
      userId: 'system-agent-user',
      jobType: 'triple-beat-scan',
      status: 'queued',
      input: { tradingDate: '2026-04-07' },
    }]);
    expect(db._state.updateValues).toEqual([{
      jobId: 'macro-job-1',
      status: 'completed',
      completedAt: expect.any(Object),
    }]);

    await handle.stop();
  });

  it('dedupes concurrent ticks by skipping job creation when the on-conflict insert returns no row', async () => {
    vi.setSystemTime(new Date('2026-04-07T13:00:00.000Z'));
    const db = createDb([
      [{ id: 'scheduled-run-row' }],
      [],
    ]);
    const handle = startTripleBeatCron(db, { hourEt: 9, checkIntervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(db.execute).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(db._state.executeQueries[0])).toContain('triple-beat-scan');
    expect(db.transaction).toHaveBeenCalledTimes(2);
    expect(db._state.insertedJobs).toHaveLength(1);
    expect(db._state.updateValues).toHaveLength(1);

    await handle.stop();
  });
});

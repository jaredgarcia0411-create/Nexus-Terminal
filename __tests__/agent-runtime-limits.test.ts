import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentRegistry, agentRequestLog } from '@/lib/db/schema';
const getLlmBudgetConfigMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/agents/llm-client', () => ({
  getLlmBudgetConfig: getLlmBudgetConfigMock,
}));

import {
  checkBudget,
  checkCircuitBreaker,
  checkRateLimit,
  recordBreakerSuccess,
  recordLlmAttempt,
} from '@/lib/agents/runtime-limits';

function createDb(tableRows: Map<unknown, unknown[][]> = new Map()) {
  const insertedValues: unknown[] = [];
  const insertedByTable = new Map<unknown, Array<Record<string, unknown>>>();
  const execute = vi.fn(async () => undefined);

  const select = vi.fn((selected?: Record<string, unknown>) => ({
    from(table: unknown) {
      const queue = tableRows.get(table) ?? [];
      tableRows.set(table, queue);

      return {
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: async (count: number) => {
              const rows = queue.shift() ?? buildRowsFromInsertedState(table, selected, insertedByTable);
              return rows.slice(0, count);
            },
          })),
          limit: async (count: number) => {
            const rows = queue.shift() ?? buildRowsFromInsertedState(table, selected, insertedByTable);
            return rows.slice(0, count);
          },
        })),
      };
    },
  }));

  const insertValues = vi.fn(async (value: unknown) => {
    insertedValues.push(value);
    const rows = insertedByTable.get(agentRequestLog) ?? [];
    insertedByTable.set(agentRequestLog, rows);
    rows.push(value as Record<string, unknown>);
  });
  const insert = vi.fn(() => ({
    values: insertValues,
  }));

  return {
    execute,
    insert,
    select,
    _state: {
      insertedValues,
    },
  };
}

function buildRowsFromInsertedState(
  table: unknown,
  selected: Record<string, unknown> | undefined,
  insertedByTable: Map<unknown, Array<Record<string, unknown>>>,
): Record<string, unknown>[] {
  if (table !== agentRequestLog || !selected) {
    return [];
  }

  const rows = insertedByTable.get(agentRequestLog) ?? [];
  if ('totalCostCents' in selected) {
    return [{
      totalCostCents: rows.reduce((sum, row) => sum + Number(row.estimatedCostCents ?? 0), 0),
    }];
  }

  if ('requestCount' in selected) {
    return [{ requestCount: rows.length }];
  }

  return [];
}

describe('agent runtime limits', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-07T15:30:00.000Z'));
    process.env.AGENT_DAILY_BUDGET_CENTS = '100';
    process.env.AGENT_MONTHLY_BUDGET_CENTS = '1000';
    getLlmBudgetConfigMock.mockReset().mockReturnValue({
      dailyBudgetCents: 100,
      monthlyBudgetCents: 1000,
    });
  });

  it('throws on daily budget exhaustion before checking monthly totals', async () => {
    const rows = new Map<unknown, unknown[][]>();
    rows.set(agentRequestLog, [
      [{ totalCostCents: 100 }],
    ]);
    const db = createDb(rows);

    await expect(checkBudget(db as never, 'user-1', 'orchestrator')).rejects.toMatchObject({
      name: 'BudgetExceededError',
      message: 'daily budget exceeded for orchestrator',
    });
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('throws on monthly budget exhaustion after daily passes', async () => {
    const rows = new Map<unknown, unknown[][]>();
    rows.set(agentRequestLog, [
      [{ totalCostCents: 20 }],
      [{ totalCostCents: 1000 }],
    ]);
    const db = createDb(rows);

    await expect(checkBudget(db as never, 'user-1', 'orchestrator')).rejects.toMatchObject({
      name: 'BudgetExceededError',
      message: 'monthly budget exceeded for orchestrator',
    });
  });

  it('throws when fractional per-call costs accumulate past the daily budget', async () => {
    const db = createDb();

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await recordLlmAttempt(db as never, {
        userId: 'user-1',
        agentId: 'orchestrator',
        mode: 'chat',
        lane: 'background',
        modelUsed: 'llama-3.3-70b-versatile',
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        estimatedCostCents: 0.4,
        durationMs: 50,
        success: true,
      });
    }

    getLlmBudgetConfigMock.mockReturnValueOnce({
      dailyBudgetCents: 2,
      monthlyBudgetCents: 1000,
    });

    await expect(checkBudget(db as never, 'user-1', 'orchestrator')).rejects.toMatchObject({
      name: 'BudgetExceededError',
      message: 'daily budget exceeded for orchestrator',
      limitType: 'daily',
    });
  });

  it('throws when a user has already hit the rate limit window', async () => {
    const rows = new Map<unknown, unknown[][]>();
    rows.set(agentRequestLog, [
      [{ requestCount: 30 }],
    ]);
    const db = createDb(rows);

    await expect(checkRateLimit(db as never, 'user-1', 'orchestrator')).rejects.toMatchObject({
      name: 'RateLimitExceededError',
      message: 'rate limit exceeded for user user-1',
    });
  });

  it('rejects a fresh open circuit and self-heals a stale one', async () => {
    const freshRows = new Map<unknown, unknown[][]>();
    freshRows.set(agentRegistry, [
      [{ config: { circuitBreaker: { consecutiveFailures: 5, openedAt: '2026-04-07T15:29:30.000Z' } } }],
    ]);
    const freshDb = createDb(freshRows);

    await expect(checkCircuitBreaker(freshDb as never, 'user-1', 'orchestrator')).rejects.toMatchObject({
      name: 'CircuitOpenError',
      message: 'circuit breaker open for orchestrator since 2026-04-07T15:29:30.000Z',
    });

    const staleRows = new Map<unknown, unknown[][]>();
    staleRows.set(agentRegistry, [
      [{ config: { circuitBreaker: { consecutiveFailures: 5, openedAt: '2026-04-07T15:28:20.000Z' } } }],
    ]);
    const staleDb = createDb(staleRows);

    await expect(checkCircuitBreaker(staleDb as never, 'user-1', 'orchestrator')).resolves.toBeUndefined();
    expect(staleDb.execute).toHaveBeenCalledTimes(1);
  });

  it('records token usage with fractional costs and integer success flags', async () => {
    const db = createDb();

    await recordLlmAttempt(db as never, {
      userId: 'user-1',
      agentId: 'orchestrator',
      mode: 'chat',
      lane: 'background',
      modelUsed: 'llama-3.3',
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      estimatedCostCents: 12.6,
      durationMs: 1234,
      success: false,
    });

    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db._state.insertedValues[0]).toMatchObject({
      userId: 'user-1',
      agentId: 'orchestrator',
      mode: 'chat',
      lane: 'background',
      modelUsed: 'llama-3.3',
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      estimatedCostCents: 12.6,
      durationMs: 1234,
      success: 0,
      sourceCount: 0,
      chunkCount: 0,
    });
    expect((db._state.insertedValues[0] as { id?: string }).id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('resets the breaker state through the success helper', async () => {
    const db = createDb();

    await recordBreakerSuccess(db as never, 'orchestrator');

    expect(db.execute).toHaveBeenCalledTimes(1);
  });
});

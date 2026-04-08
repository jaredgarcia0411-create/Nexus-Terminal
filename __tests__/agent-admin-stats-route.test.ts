import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getLlmBudgetConfigMock,
  requireAgentAdminMock,
  getAgentDbMock,
} = vi.hoisted(() => ({
  getLlmBudgetConfigMock: vi.fn(),
  requireAgentAdminMock: vi.fn(),
  getAgentDbMock: vi.fn(),
}));

vi.mock('@/lib/agents/admin', () => ({
  requireAgentAdmin: requireAgentAdminMock,
}));

vi.mock('@/lib/agents/db', () => ({
  getAgentDb: getAgentDbMock,
}));

vi.mock('@/lib/agents/llm-client', () => ({
  getLlmBudgetConfig: getLlmBudgetConfigMock,
}));

vi.mock('@/lib/server-db-utils', () => ({
  dbUnavailable: () => Response.json({ error: 'Database not configured' }, { status: 503 }),
}));

import { GET } from '@/app/api/agents/admin/stats/route';

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected response');
  return response;
}

function selectImmediate(rows: unknown[]) {
  return {
    from: vi.fn().mockResolvedValue(rows),
  };
}

function selectWhere(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn().mockResolvedValue(rows),
    })),
  };
}

function selectWhereOrderLimit(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        orderBy: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue(rows),
        })),
      })),
    })),
  };
}

function createStatsDb() {
  const selectMock = vi.fn()
    .mockReturnValueOnce(selectImmediate([
      {
        id: 'orchestrator',
        displayName: 'Orchestrator',
        status: 'online',
        lastHeartbeat: new Date('2026-04-08T11:59:30.000Z'),
        config: {
          circuitBreaker: {
            consecutiveFailures: 2,
            openedAt: '2026-04-08T11:59:45.000Z',
          },
        },
      },
    ]))
    .mockReturnValueOnce(selectWhere([
      {
        agentId: 'orchestrator',
        lane: 'interactive',
        totalTokens: 150,
        estimatedCostCents: 3,
        durationMs: 1200,
        success: true,
      },
    ]))
    .mockReturnValueOnce(selectWhere([
      {
        agentId: 'orchestrator',
        lane: 'interactive',
        totalTokens: 900,
        estimatedCostCents: 18,
        durationMs: 6000,
        success: true,
      },
    ]))
    .mockReturnValueOnce(selectWhere([
      {
        attempt: 2,
        stepLog: [{ errorClass: 'contract' }],
      },
    ]))
    .mockReturnValueOnce(selectWhere([
      { status: 'published' },
      { status: 'delivery_failed' },
    ]))
    .mockReturnValueOnce(selectImmediate([
      { category: 'fact' },
      { category: 'fact' },
      { category: 'macro_fact' },
    ]))
    .mockReturnValueOnce(selectWhereOrderLimit([
      {
        createdAt: new Date('2026-04-08T11:30:00.000Z'),
      },
    ]))
    .mockReturnValueOnce(selectWhere([
      {
        createdAt: new Date('2026-04-08T11:50:00.000Z'),
        nextRetryAt: null,
      },
      {
        createdAt: new Date('2026-04-08T11:40:00.000Z'),
        nextRetryAt: new Date('2026-04-08T12:01:00.000Z'),
      },
    ]))
    .mockReturnValueOnce(selectWhere([
      {
        lockExpiresAt: new Date('2026-04-08T11:59:00.000Z'),
        lastHeartbeatAt: new Date('2026-04-08T11:59:30.000Z'),
      },
      {
        lockExpiresAt: new Date('2026-04-08T12:10:00.000Z'),
        lastHeartbeatAt: new Date('2026-04-08T11:40:00.000Z'),
      },
      {
        lockExpiresAt: new Date('2026-04-08T12:10:00.000Z'),
        lastHeartbeatAt: new Date('2026-04-08T11:59:30.000Z'),
      },
    ]));

  return {
    select: selectMock,
  };
}

describe('agent admin stats route', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-08T12:00:00.000Z'));
    vi.clearAllMocks();
    requireAgentAdminMock.mockReturnValue(null);
    getLlmBudgetConfigMock.mockReturnValue({
      dailyBudgetCents: 100,
      monthlyBudgetCents: 1000,
      maxContextTokens: 0,
      maxScanCandidates: 0,
      maxPatternHistoryItems: 0,
      maxRetriesPerStep: 0,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the full stats response shape and queue metrics', async () => {
    getAgentDbMock.mockReturnValueOnce(createStatsDb());

    const response = ensureResponse(await GET(new Request('http://localhost/api/agents/admin/stats')));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.circuitBreakers).toEqual({
      orchestrator: {
        status: 'open',
        consecutiveFailures: 2,
        lastFailureAt: '2026-04-08T11:59:45.000Z',
      },
    });
    expect(payload.today).toEqual({
      totalRequests: 1,
      totalTokens: 150,
      estimatedCostCents: 3,
      successRate: 1,
      avgDurationMs: 1200,
      validationFailureRate: 1,
      retryRate: 1,
      byLane: {
        interactive: {
          totalRequests: 1,
          totalTokens: 150,
          estimatedCostCents: 3,
          successRate: 1,
          avgDurationMs: 1200,
        },
      },
      byAgent: {
        orchestrator: {
          totalRequests: 1,
          totalTokens: 150,
          estimatedCostCents: 3,
          successRate: 1,
          avgDurationMs: 1200,
        },
      },
    });
    expect(payload.thisMonth).toEqual({
      totalTokens: 900,
      estimatedCostCents: 18,
      budgetCents: 1000,
      budgetUsedPercent: 1.7999999999999998,
    });
    expect(payload.thisMonth.budgetUsedPercent).toBeCloseTo(1.8, 10);
    expect(payload.agents).toEqual([
      {
        id: 'orchestrator',
        displayName: 'Orchestrator',
        status: 'online',
        lastHeartbeat: '2026-04-08T11:59:30.000Z',
      },
    ]);
    expect(payload.delivery).toEqual({
      publishedToday: 1,
      deliveryFailures: 1,
      deliveryFailureRate: 0.5,
    });
    expect(payload.memory).toEqual({
      total: 3,
      byCategory: {
        fact: 2,
        macro_fact: 1,
      },
    });
    expect(payload.macroSummaries).toEqual({
      latestGeneratedAt: '2026-04-08T11:30:00.000Z',
    });
    expect(payload.queue).toEqual({
      depth: 1,
      oldestQueuedJobAgeSeconds: 600,
      stuckProcessing: 2,
    });
  });

  it('returns 503 when the stats database is unavailable', async () => {
    getAgentDbMock.mockReturnValueOnce(null);

    const response = ensureResponse(await GET(new Request('http://localhost/api/agents/admin/stats')));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({ error: 'Database not configured' });
  });

  it('returns 401 when the admin key is missing', async () => {
    requireAgentAdminMock.mockReturnValueOnce(
      Response.json({ error: 'Unauthorized' }, { status: 401 }),
    );

    const response = ensureResponse(await GET(new Request('http://localhost/api/agents/admin/stats')));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: 'Unauthorized' });
    expect(getAgentDbMock).not.toHaveBeenCalled();
  });
});

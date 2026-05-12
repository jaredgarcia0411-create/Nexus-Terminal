import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agentReports } from '@/lib/db/schema';
import type { MarketPulseReport } from '@/lib/agents/types';

const {
  getAgentDbMock,
  andMock,
  descMock,
  eqMock,
} = vi.hoisted(() => ({
  getAgentDbMock: vi.fn(),
  andMock: vi.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
  descMock: vi.fn((field: unknown) => ({ type: 'desc', field })),
  eqMock: vi.fn((field: unknown, value: unknown) => ({ type: 'eq', field, value })),
}));

vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm');
  return {
    ...actual,
    and: andMock,
    desc: descMock,
    eq: eqMock,
  };
});

vi.mock('@/lib/agents/db', () => ({
  getAgentDb: getAgentDbMock,
}));

vi.mock('@/lib/server-db-utils', () => ({
  dbUnavailable: () => Response.json({ error: 'Database not configured' }, { status: 503 }),
}));

import { GET } from '@/app/api/agents/market-pulse/latest/route';

function createMarketPulseDb(row: Record<string, unknown> | null) {
  const limitMock = vi.fn().mockResolvedValue(row ? [row] : []);
  const orderByMock = vi.fn(() => ({
    limit: limitMock,
  }));

  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: orderByMock,
        })),
      })),
    })),
    orderByMock,
  };
}

describe('agent market pulse route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the latest system-owned market pulse without generation side effects', async () => {
    const report: MarketPulseReport = {
      tradingDate: '2026-05-08',
      marketStrength: 'mixed',
      confidence: 'medium',
      tldr: ['Breadth was balanced.'],
      summary: 'Market strength was mixed.',
      breadth: { advancers: 100, decliners: 90, unchanged: 10, advancerPct: 50, upVolumePct: 52 },
      rolling30: {
        tradingDays: 30,
        avgAdvancerPct: 51,
        medianAdvancerPct: 50,
        strongDays: 10,
        weakDays: 8,
        newHigh30dAvg: 12,
        newLow30dAvg: 9,
      },
      leaders: [],
      laggards: [],
      sectorNotes: [],
      riskFlags: [],
      sourceIndex: [],
    };
    const db = createMarketPulseDb({
      generatedAt: new Date('2026-05-08T22:00:00.000Z'),
      content: report,
      status: 'delivery_failed',
      deliveryError: 'discord missing',
    });
    getAgentDbMock.mockReturnValueOnce(db);

    const response = await GET(new Request('http://localhost/api/agents/market-pulse/latest'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      pulse: {
        generated_at: '2026-05-08T22:00:00.000Z',
        content: report,
        status: 'delivery_failed',
        deliveryError: 'discord missing',
      },
    });
    expect(eqMock).toHaveBeenCalledWith(expect.anything(), 'system-agent-user');
    expect(eqMock).toHaveBeenCalledWith(expect.anything(), 'orchestrator');
    expect(eqMock).toHaveBeenCalledWith(expect.anything(), 'market-pulse');
    expect(andMock).toHaveBeenCalledTimes(1);
  });

  it('orders by report trading date before generated timestamp', async () => {
    const db = createMarketPulseDb(null);
    getAgentDbMock.mockReturnValueOnce(db);

    await GET(new Request('http://localhost/api/agents/market-pulse/latest'));

    expect(descMock).toHaveBeenCalledTimes(2);
    expect(descMock.mock.calls[1][0]).toBe(agentReports.createdAt);
    expect(db.orderByMock).toHaveBeenCalledWith(
      descMock.mock.results[0].value,
      descMock.mock.results[1].value,
    );
  });

  it('returns null when no market pulse report exists', async () => {
    getAgentDbMock.mockReturnValueOnce(createMarketPulseDb(null));

    const response = await GET(new Request('http://localhost/api/agents/market-pulse/latest'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ pulse: null });
  });

  it('returns 503 when the database is unavailable', async () => {
    getAgentDbMock.mockReturnValueOnce(null);

    const response = await GET(new Request('http://localhost/api/agents/market-pulse/latest'));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({ error: 'Database not configured' });
  });
});

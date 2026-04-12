import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MacroSummaryReport } from '@/lib/agents/types';

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

import { GET } from '@/app/api/agents/macro-summary/latest/route';

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected response');
  return response;
}

function createMacroSummaryDb(row: Record<string, unknown> | null) {
  const limitMock = vi.fn().mockResolvedValue(row ? [row] : []);

  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: limitMock,
          })),
        })),
      })),
    })),
  };
}

describe('agent macro summary route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the latest macro summary and targets the system-owned macro report query', async () => {
    const report: MacroSummaryReport = {
      tradingDate: '2026-04-08',
      marketBias: 'neutral',
      summary: 'Rates steady',
      drivers: [
        {
          driver: 'Fed held rates steady',
          impact: 'mixed',
          sourceRefs: ['headline:marketwatch.com'],
        },
      ],
      crossAssetSnapshot: [
        { ticker: 'SPY', price: 509.12, changePercent: 0.32 },
      ],
      scheduledCatalysts: [
        {
          event: 'CPI release',
          date: '2026-04-10',
          expectedImpact: 'Could shift rate cut timing',
        },
      ],
      sectorRotation: ['Tech held leadership'],
      deskImplications: ['Stay selective into the open'],
      sourceIndex: [
        {
          id: 'headline:marketwatch.com',
          title: 'marketwatch.com headlines',
          url: 'https://www.marketwatch.com/latest-news',
          fetchedAt: '2026-04-08T12:00:00.000Z',
        },
      ],
      confidence: 'medium',
    };

    getAgentDbMock.mockReturnValueOnce(createMacroSummaryDb({
      generatedAt: new Date('2026-04-08T12:00:00.000Z'),
      content: report,
      status: 'delivery_failed',
      deliveryError: 'webhook exploded',
    }));

    const response = ensureResponse(await GET(new Request('http://localhost/api/agents/macro-summary/latest')));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      summary: {
        generated_at: '2026-04-08T12:00:00.000Z',
        content: report,
        status: 'delivery_failed',
        deliveryError: 'webhook exploded',
      },
    });
    expect(eqMock).toHaveBeenCalledWith(expect.anything(), 'system-agent-user');
    expect(eqMock).toHaveBeenCalledWith(expect.anything(), 'orchestrator');
    expect(eqMock).toHaveBeenCalledWith(expect.anything(), 'macro-summary');
    expect(eqMock).not.toHaveBeenCalledWith(expect.anything(), 'published');
    expect(andMock).toHaveBeenCalledTimes(1);
  });

  it('returns a null summary when no macro summary exists', async () => {
    getAgentDbMock.mockReturnValueOnce(createMacroSummaryDb(null));

    const response = ensureResponse(await GET(new Request('http://localhost/api/agents/macro-summary/latest')));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ summary: null });
  });

  it('returns 503 when the macro summary database is unavailable', async () => {
    getAgentDbMock.mockReturnValueOnce(null);

    const response = ensureResponse(await GET(new Request('http://localhost/api/agents/macro-summary/latest')));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({ error: 'Database not configured' });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  captureMarketPulseForDateMock,
  getDbMock,
  requireCronSecretMock,
  randomUUIDMock,
} = vi.hoisted(() => ({
  captureMarketPulseForDateMock: vi.fn(),
  getDbMock: vi.fn(),
  requireCronSecretMock: vi.fn(),
  randomUUIDMock: vi.fn(() => 'market-pulse-job-1'),
}));

vi.mock('node:crypto', () => ({
  randomUUID: randomUUIDMock,
}));

vi.mock('@/lib/db', () => ({
  getDb: getDbMock,
}));

vi.mock('@/lib/server-db-utils', () => ({
  dbUnavailable: () => Response.json({ error: 'Database not configured' }, { status: 503 }),
  requireCronSecret: requireCronSecretMock,
}));

vi.mock('@/lib/market-pulse/capture', () => ({
  captureMarketPulseForDate: captureMarketPulseForDateMock,
}));

import { GET } from '@/app/api/cron/market-pulse-eod/route';

function createDb() {
  const limitMock = vi.fn().mockResolvedValue([]);
  const insertValuesMock = vi.fn().mockResolvedValue(undefined);
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: limitMock,
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: insertValuesMock,
    })),
    limitMock,
    insertValuesMock,
  };
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe('market pulse eod route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCronSecretMock.mockReturnValue(null);
    captureMarketPulseForDateMock.mockResolvedValue({
      skipped: false,
      barsUpserted: 2,
      statsUpserted: 1,
      stats: { tradeDate: '2026-05-08' },
    });
  });

  it('requires cron auth', async () => {
    requireCronSecretMock.mockReturnValueOnce(Response.json({ error: 'Unauthorized' }, { status: 401 }));

    const response = await GET(new Request('http://localhost/api/cron/market-pulse-eod'));

    expect(response.status).toBe(401);
    expect(captureMarketPulseForDateMock).not.toHaveBeenCalled();
  });

  it('captures an explicit date and enqueues one idempotent market-pulse job', async () => {
    const db = createDb();
    getDbMock.mockReturnValueOnce(db);

    const response = await GET(new Request('http://localhost/api/cron/market-pulse-eod?date=2026-05-08'));
    const payload = await json(response);

    expect(response.status).toBe(200);
    expect(captureMarketPulseForDateMock).toHaveBeenCalledWith(db, '2026-05-08');
    expect(db.insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      id: 'market-pulse-job-1',
      agentId: 'orchestrator',
      userId: 'system-agent-user',
      jobType: 'market-pulse',
      status: 'queued',
      input: { tradingDate: '2026-05-08' },
    }));
    expect(payload).toMatchObject({
      evaluatedDates: ['2026-05-08'],
      barsUpserted: 2,
      statsUpserted: 1,
      jobsEnqueued: 1,
      skippedNonTradingDays: 0,
    });
  });

  it('supports bounded backfill and caps days at 30', async () => {
    const db = createDb();
    getDbMock.mockReturnValueOnce(db);

    await GET(new Request('http://localhost/api/cron/market-pulse-eod?from=2026-05-08&days=99'));

    expect(captureMarketPulseForDateMock).toHaveBeenCalledTimes(30);
    expect(captureMarketPulseForDateMock.mock.calls[0][1]).toBe('2026-05-08');
    expect(captureMarketPulseForDateMock.mock.calls[1][1]).toBe('2026-05-07');
  });

  it('summarizes non-trading skips without enqueuing a job', async () => {
    const db = createDb();
    getDbMock.mockReturnValueOnce(db);
    captureMarketPulseForDateMock.mockResolvedValueOnce({
      skipped: true,
      barsUpserted: 0,
      statsUpserted: 0,
      stats: null,
    });

    const response = await GET(new Request('http://localhost/api/cron/market-pulse-eod?date=2026-05-09'));
    const payload = await json(response);

    expect(payload).toMatchObject({
      evaluatedDates: [],
      barsUpserted: 0,
      statsUpserted: 0,
      jobsEnqueued: 0,
      skippedNonTradingDays: 1,
    });
    expect(db.insertValuesMock).not.toHaveBeenCalled();
  });
});

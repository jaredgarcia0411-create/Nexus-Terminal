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
      jobsEnqueuedDates: ['2026-05-08'],
      skippedNonTradingDays: 0,
      skippedDates: [],
      existingReportDates: [],
      existingJobDates: [],
    });
  });

  it('supports enqueue=0 for stats-only backfills', async () => {
    const db = createDb();
    getDbMock.mockReturnValueOnce(db);

    const response = await GET(new Request('http://localhost/api/cron/market-pulse-eod?date=2026-05-08&enqueue=0'));
    const payload = await json(response);

    expect(response.status).toBe(200);
    expect(captureMarketPulseForDateMock).toHaveBeenCalledWith(db, '2026-05-08');
    expect(db.select).not.toHaveBeenCalled();
    expect(db.insertValuesMock).not.toHaveBeenCalled();
    expect(payload).toMatchObject({
      evaluatedDates: ['2026-05-08'],
      jobsEnqueued: 0,
      jobsEnqueuedDates: [],
      existingReportDates: [],
      existingJobDates: [],
    });
  });

  it('reports existing market-pulse reports and jobs instead of enqueuing duplicates', async () => {
    const db = createDb();
    getDbMock.mockReturnValueOnce(db);
    db.limitMock.mockResolvedValueOnce([{ id: 'report-1' }]);

    const reportResponse = await GET(new Request('http://localhost/api/cron/market-pulse-eod?date=2026-05-08'));
    const reportPayload = await json(reportResponse);

    expect(reportPayload).toMatchObject({
      jobsEnqueued: 0,
      jobsEnqueuedDates: [],
      existingReportDates: ['2026-05-08'],
      existingJobDates: [],
    });
    expect(db.insertValuesMock).not.toHaveBeenCalled();

    vi.clearAllMocks();
    requireCronSecretMock.mockReturnValue(null);
    captureMarketPulseForDateMock.mockResolvedValue({
      skipped: false,
      barsUpserted: 2,
      statsUpserted: 1,
      stats: { tradeDate: '2026-05-08' },
    });
    const dbWithJob = createDb();
    getDbMock.mockReturnValueOnce(dbWithJob);
    dbWithJob.limitMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'job-1' }]);

    const jobResponse = await GET(new Request('http://localhost/api/cron/market-pulse-eod?date=2026-05-08'));
    const jobPayload = await json(jobResponse);

    expect(jobPayload).toMatchObject({
      jobsEnqueued: 0,
      jobsEnqueuedDates: [],
      existingReportDates: [],
      existingJobDates: ['2026-05-08'],
    });
    expect(dbWithJob.insertValuesMock).not.toHaveBeenCalled();
  });

  it('enqueues from an existing stats row when an explicit date recapture fails', async () => {
    const db = createDb();
    getDbMock.mockReturnValueOnce(db);
    captureMarketPulseForDateMock.mockRejectedValueOnce(new Error('stored bars reload failed'));
    db.limitMock
      .mockResolvedValueOnce([{ tradeDate: '2026-05-08' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const response = await GET(new Request('http://localhost/api/cron/market-pulse-eod?date=2026-05-08&enqueue=1'));
    const payload = await json(response);

    expect(response.status).toBe(200);
    expect(db.insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'orchestrator',
      userId: 'system-agent-user',
      jobType: 'market-pulse',
      status: 'queued',
      input: { tradingDate: '2026-05-08' },
    }));
    expect(payload).toMatchObject({
      evaluatedDates: ['2026-05-08'],
      barsUpserted: 0,
      statsUpserted: 0,
      jobsEnqueued: 1,
      jobsEnqueuedDates: ['2026-05-08'],
      errors: [],
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

  it('does not let skipped non-trading dates consume the requested trading-day count', async () => {
    const db = createDb();
    getDbMock.mockReturnValueOnce(db);
    captureMarketPulseForDateMock.mockImplementation((_db, tradeDate: string) => {
      if (tradeDate === '2026-05-10' || tradeDate === '2026-05-09') {
        return Promise.resolve({
          skipped: true,
          barsUpserted: 0,
          statsUpserted: 0,
          stats: null,
        });
      }

      return Promise.resolve({
        skipped: false,
        barsUpserted: 2,
        statsUpserted: 1,
        stats: { tradeDate },
      });
    });

    const response = await GET(new Request('http://localhost/api/cron/market-pulse-eod?from=2026-05-10&days=2&enqueue=0'));
    const payload = await json(response);

    expect(captureMarketPulseForDateMock).toHaveBeenCalledTimes(4);
    expect(captureMarketPulseForDateMock.mock.calls.map((call) => call[1])).toEqual([
      '2026-05-10',
      '2026-05-09',
      '2026-05-08',
      '2026-05-07',
    ]);
    expect(payload).toMatchObject({
      evaluatedDates: ['2026-05-08', '2026-05-07'],
      jobsEnqueued: 0,
      skippedNonTradingDays: 2,
      skippedDates: ['2026-05-10', '2026-05-09'],
    });
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
      skippedDates: ['2026-05-09'],
    });
    expect(db.insertValuesMock).not.toHaveBeenCalled();
  });
});

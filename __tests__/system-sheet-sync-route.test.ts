import { beforeEach, describe, expect, it, vi } from 'vitest';
import { systemTickers as systemTickersTable } from '@/lib/db/schema';

const {
  getPoolDbMock,
  requireUserMock,
  ensureUserMock,
} = vi.hoisted(() => ({
  getPoolDbMock: vi.fn(),
  requireUserMock: vi.fn(),
  ensureUserMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getPoolDb: getPoolDbMock,
}));

vi.mock('@/lib/server-db-utils', () => ({
  dbUnavailable: () => Response.json({ error: 'Database not configured' }, { status: 503 }),
  ensureUser: ensureUserMock,
  requireUser: requireUserMock,
}));

import { POST } from '@/app/api/system-sheet/sync/route';

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ticker: 'AUUD',
    date: '2026-04-23',
    grade: 'A',
    primaryAgenda: 'Primary',
    secondaryAgenda: 'Secondary',
    setupType: 'Gap Up',
    outcome: 'Win',
    tickerWinLoss: 'W',
    tickerR: 1.5,
    triggerCount: 2,
    day1GapPct: 23.5,
    attempts: [
      {
        attemptIndex: 1,
        triggerType: 'Big Trig',
        starter: { riskDollars: 100, time: '9:31' },
        fmTrig: { triggerType: 'Big Trig', price: 2.5 },
        fmTrigSub30: {},
        popVwap: {},
        fmCloseSubPiv: {},
        exit: { r: 1.5, wl: 'W' },
      },
    ],
    rawJson: { Ticker: 'AUUD', 'Day 1 Date': '2026-04-23' },
    ...overrides,
  };
}

function makeDb(returningRows: Array<{ id: string; importedAt: Date; updatedAt: Date }>) {
  const onConflictDoUpdateMock = vi.fn(() => ({
    returning: vi.fn(async () => {
      const next = returningRows.shift();
      return next ? [next] : [];
    }),
  }));

  const insertValuesMock = vi.fn(() => ({
    onConflictDoUpdate: onConflictDoUpdateMock,
  }));

  const tx = {
    insert: vi.fn((table: unknown) => {
      if (table === systemTickersTable) {
        return { values: insertValuesMock };
      }

      throw new Error('Unexpected insert table in test mock');
    }),
  };

  return {
    transaction: vi.fn(async (callback: (arg: typeof tx) => Promise<void>) => callback(tx)),
    _mocks: {
      insertValuesMock,
      onConflictDoUpdateMock,
      tx,
    },
  };
}

describe('POST /api/system-sheet/sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: 'user-1', email: 'u@example.com', name: null, picture: null } });
    ensureUserMock.mockResolvedValue(undefined);
  });

  it('returns auth errors from requireUser', async () => {
    requireUserMock.mockResolvedValue({ error: Response.json({ error: 'Unauthorized' }, { status: 401 }) });

    const response = await POST(new Request('http://localhost/api/system-sheet/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: [makeRow()] }),
    }));
    if (!response) throw new Error('Expected response');

    expect(response.status).toBe(401);
  });

  it('returns 400 when the body fails Zod validation', async () => {
    const db = makeDb([]);
    getPoolDbMock.mockReturnValue(db);

    const response = await POST(new Request('http://localhost/api/system-sheet/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: [] }),
    }));
    if (!response) throw new Error('Expected response');

    expect(response.status).toBe(400);

    const badDateResponse = await POST(new Request('http://localhost/api/system-sheet/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: [makeRow({ date: '4/23/2026' })] }),
    }));
    if (!badDateResponse) throw new Error('Expected response');

    expect(badDateResponse.status).toBe(400);
  });

  it('counts a fresh row as inserted', async () => {
    const db = makeDb([
      {
        id: 'row-1',
        importedAt: new Date('2026-04-23T15:00:00.000Z'),
        updatedAt: new Date('2026-04-23T15:00:00.002Z'),
      },
    ]);
    getPoolDbMock.mockReturnValue(db);

    const response = await POST(new Request('http://localhost/api/system-sheet/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: [makeRow()] }),
    }));
    if (!response) throw new Error('Expected response');

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ inserted: 1, updated: 0, total: 1 });
  });

  it('counts a second call with the same key as updated and targets ticker/date for the upsert', async () => {
    const db = makeDb([
      {
        id: 'row-1',
        importedAt: new Date('2026-04-23T15:00:00.000Z'),
        updatedAt: new Date('2026-04-23T15:00:00.002Z'),
      },
      {
        id: 'row-1',
        importedAt: new Date('2026-04-23T15:00:00.000Z'),
        updatedAt: new Date('2026-04-23T15:05:00.000Z'),
      },
    ]);
    getPoolDbMock.mockReturnValue(db);

    const firstResponse = await POST(new Request('http://localhost/api/system-sheet/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: [makeRow()] }),
    }));
    if (!firstResponse) throw new Error('Expected response');
    expect(firstResponse.status).toBe(200);

    const secondResponse = await POST(new Request('http://localhost/api/system-sheet/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: [makeRow()] }),
    }));
    if (!secondResponse) throw new Error('Expected response');

    const payload = await secondResponse.json();

    expect(payload).toEqual({ inserted: 0, updated: 1, total: 1 });
    expect(db._mocks.onConflictDoUpdateMock).toHaveBeenCalledWith(expect.objectContaining({
      target: [systemTickersTable.ticker, systemTickersTable.date],
    }));
  });
});

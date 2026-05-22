import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireUserMock,
  ensureUserMock,
  getDbMock,
} = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  ensureUserMock: vi.fn(),
  getDbMock: vi.fn(),
}));

vi.mock('@/lib/server-db-utils', () => ({
  requireUser: requireUserMock,
  ensureUser: ensureUserMock,
  dbUnavailable: () => Response.json({ error: 'DB unavailable' }, { status: 503 }),
}));
vi.mock('@/lib/db', () => ({ getDb: getDbMock }));

import { GET, PUT } from '@/app/api/chart-drawings/route';
import { chartDrawings } from '@/lib/db/schema';

type ChartDrawingRow = {
  userId: string;
  ticker: string;
  bucket: 'intraday' | 'higher';
  drawings: unknown[];
  indicators: Record<string, string[]>;
  updatedAt: Date;
};

function createChartDrawingsDb() {
  const state: { rows: ChartDrawingRow[] } = { rows: [] };

  return {
    state,
    select() {
      return {
        from(table: unknown) {
          expect(table).toBe(chartDrawings);
          return this;
        },
        where() {
          return Promise.resolve(state.rows.map((row) => ({ ...row })));
        },
      };
    },
    insert(table: unknown) {
      expect(table).toBe(chartDrawings);
      return {
        values(values: ChartDrawingRow) {
          return {
            onConflictDoUpdate({ set }: { set: Partial<ChartDrawingRow> }) {
              const existing = state.rows.find((row) =>
                row.userId === values.userId
                && row.ticker === values.ticker
                && row.bucket === values.bucket
              );

              if (existing) {
                Object.assign(existing, set);
              } else {
                state.rows.push({ ...values });
              }

              return Promise.resolve();
            },
          };
        },
      };
    },
  };
}

async function json(response: Response) {
  return response.json() as Promise<unknown>;
}

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected response');
  return response;
}

describe('chart drawings route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: 'u1', email: 'u1@example.com', name: null, picture: null } });
    ensureUserMock.mockResolvedValue(undefined);
    getDbMock.mockReturnValue(createChartDrawingsDb());
  });

  it('returns empty buckets when no rows exist', async () => {
    const response = ensureResponse(await GET(new Request('http://localhost/api/chart-drawings?ticker=SNDK')));

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({
      intraday: { drawings: [], indicators: {} },
      higher: { drawings: [], indicators: {} },
    });
  });

  it('round-trips a PUT payload and uppercases the ticker before storing', async () => {
    const db = createChartDrawingsDb();
    getDbMock.mockReturnValue(db);

    const body = {
      drawings: [{ id: 'line-1', type: 'horizontal', price: 10, time: 1, color: '#fff', lineWidth: 1 }],
      indicators: { primary: ['VWAP'] },
    };
    const putResponse = ensureResponse(await PUT(new Request('http://localhost/api/chart-drawings?ticker=sndk&bucket=intraday', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })));

    expect(putResponse.status).toBe(200);
    expect(db.state.rows[0]?.ticker).toBe('SNDK');

    const getResponse = ensureResponse(await GET(new Request('http://localhost/api/chart-drawings?ticker=SNDK')));

    expect(getResponse.status).toBe(200);
    expect(await json(getResponse)).toEqual({
      intraday: body,
      higher: { drawings: [], indicators: {} },
    });
  });

  it('upserts by user, ticker, and bucket', async () => {
    const db = createChartDrawingsDb();
    getDbMock.mockReturnValue(db);

    const first = { drawings: [{ id: 'first' }], indicators: { primary: ['VWAP'] } };
    const second = { drawings: [{ id: 'second' }], indicators: { primary: ['EMA20'] } };

    for (const body of [first, second]) {
      const response = ensureResponse(await PUT(new Request('http://localhost/api/chart-drawings?ticker=SNDK&bucket=higher', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })));
      expect(response.status).toBe(200);
    }

    expect(db.state.rows).toHaveLength(1);
    expect(db.state.rows[0]).toMatchObject({
      ticker: 'SNDK',
      bucket: 'higher',
      drawings: second.drawings,
      indicators: second.indicators,
    });
  });

  it('returns 401 when no session exists', async () => {
    requireUserMock.mockResolvedValue({ error: Response.json({ error: 'Unauthorized' }, { status: 401 }) });

    const response = ensureResponse(await GET(new Request('http://localhost/api/chart-drawings?ticker=SNDK')));

    expect(response.status).toBe(401);
    expect(getDbMock).not.toHaveBeenCalled();
  });
});

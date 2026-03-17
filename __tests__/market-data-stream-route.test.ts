import { beforeEach, describe, expect, it, vi } from 'vitest';

import { marketSnapshots, realtimeQuotes, schwabLinks } from '@/lib/db/schema';

const {
  getDbMock,
  requireUserMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  requireUserMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ getDb: getDbMock }));
vi.mock('@/lib/server-db-utils', () => ({
  requireUser: requireUserMock,
}));

import { GET } from '@/app/api/market-data/stream/route';

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected response');
  return response;
}

function parseSseEvents(
  body: ReadableStream<Uint8Array> | null,
  maxEvents: number,
  abortController: AbortController,
) {
  return (async () => {
    if (!body) {
      throw new Error('Expected stream body');
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    let buffer = '';

    while (events.length < maxEvents) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const raw = buffer.split('\n\n');
      buffer = raw.pop() ?? '';

      for (const frame of raw) {
        let event = '';
        let dataText = '';
        for (const line of frame.split('\n')) {
          if (line.startsWith('event: ')) event = line.slice(7);
          if (line.startsWith('data: ')) dataText = line.slice(6);
        }

        if (dataText) {
          events.push({ event, data: JSON.parse(dataText) as Record<string, unknown> });
        }
      }
    }

    abortController.abort();
    await reader.cancel();

    return events;
  })();
}

function makeDbMock({
  link,
  quotes,
  snapshotRows,
}: {
  link: Array<{ id: string; status: 'active' | 'revoked' | 'expired'; refreshTokenExpiresAt: Date }>;
  quotes: Array<{
    symbol: string;
    assetType: 'equity' | 'etf' | 'future' | 'forex' | 'index' | 'crypto';
    lastPrice: number | null;
    netChange: number | null;
    netChangePercent: number | null;
    totalVolume: number | null;
    securityStatus: string | null;
    updatedAt: Date;
  }>;
  snapshotRows: Array<{ dataJson: { gainers?: unknown[]; losers?: unknown[] } }>;
}) {
  const linkLimit = vi.fn(async () => link);
  const snapshotLimit = vi.fn(async () => snapshotRows);

  return {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        if (table === schwabLinks) {
          return {
            where: vi.fn(() => ({
              limit: linkLimit,
            })),
          };
        }

        if (table === realtimeQuotes) {
          return Promise.resolve(quotes);
        }

        if (table === marketSnapshots) {
          return {
            where: vi.fn(() => ({
              orderBy: vi.fn(() => ({
                limit: snapshotLimit,
              })),
            })),
          };
        }

        return Promise.resolve([]);
      }),
    })),
    _mocks: {
      linkLimit,
      snapshotLimit,
    },
  };
}

describe('market data stream route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({
      user: {
        id: 'u1',
        email: 'user@example.com',
        name: null,
        picture: null,
      },
    });
  });

  it('returns 401 when unauthenticated', async () => {
    requireUserMock.mockResolvedValueOnce({ error: Response.json({ error: 'Unauthorized' }, { status: 401 }) });

    const response = ensureResponse(await GET(new Request('http://localhost/api/market-data/stream')));

    expect(response.status).toBe(401);
  });

  it('returns 503 when database is unavailable', async () => {
    getDbMock.mockReturnValue(null);

    const response = ensureResponse(await GET(new Request('http://localhost/api/market-data/stream')));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({ error: 'Database unavailable' });
  });

  it('returns 400 when no active link exists', async () => {
    const db = makeDbMock({
      link: [],
      quotes: [],
      snapshotRows: [],
    });
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(await GET(new Request('http://localhost/api/market-data/stream')));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'realtime_unavailable' });
  });

  it('streams snapshot and scanner data for active linked users', async () => {
    const db = makeDbMock({
      link: [
        {
          id: 'link-1',
          status: 'active',
          refreshTokenExpiresAt: new Date(Date.now() + 3600_000),
        },
      ],
      quotes: [
        {
          symbol: 'AAPL',
          assetType: 'equity',
          lastPrice: 210.5,
          netChange: 2.3,
          netChangePercent: 1.1,
          totalVolume: 1_200_000,
          securityStatus: 'OPEN',
          updatedAt: new Date('2026-03-17T14:30:00.000Z'),
        },
      ],
      snapshotRows: [
        {
          dataJson: {
            gainers: [{
              symbol: 'AAPL',
              lastPrice: 210.5,
              netChange: 2.3,
              netChangePercent: 1.1,
              totalVolume: 1_200_000,
            }],
            losers: [],
          },
        },
      ],
    });
    getDbMock.mockReturnValue(db);

    const abortController = new AbortController();
    const response = ensureResponse(await GET(new Request('http://localhost/api/market-data/stream?limit=1&sortBy=symbol', {
      method: 'GET',
      signal: abortController.signal,
    })));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const events = await parseSseEvents(response.body, 2, abortController);

    expect(events).toHaveLength(2);
    expect(events[0].event).toBe('snapshot');
    expect(events[0].data).toMatchObject({
      dataSource: 'realtime',
      mappedSnapshot: {
        indices: expect.any(Array),
        equities: expect.arrayContaining([
          expect.objectContaining({
            symbol: 'AAPL',
            price: 210.5,
          }),
        ]),
      },
    });

    expect(events[1].event).toBe('scanner');
    expect(events[1].data).toMatchObject({
      results: [
        expect.objectContaining({
          symbol: 'AAPL',
          lastPrice: 210.5,
        }),
      ],
    });

    expect(db._mocks.linkLimit).toHaveBeenCalledTimes(1);
    expect(db._mocks.snapshotLimit).toHaveBeenCalledTimes(1);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AskEdgarResponse } from '@/lib/askedgar';

const {
  requireUserMock,
  getCachedTickerDataMock,
  fetchUnifiedSnapshotMock,
} = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  getCachedTickerDataMock: vi.fn(),
  fetchUnifiedSnapshotMock: vi.fn(),
}));

vi.mock('@/lib/server-db-utils', () => ({
  requireUser: requireUserMock,
}));

vi.mock('@/lib/massive-market', () => ({
  fetchUnifiedSnapshot: fetchUnifiedSnapshotMock,
}));

vi.mock('@/lib/askedgar', async () => {
  const actual = await vi.importActual<typeof import('@/lib/askedgar')>('@/lib/askedgar');
  return {
    ...actual,
    getCachedTickerData: getCachedTickerDataMock,
  };
});

import { GET } from '@/app/api/askedgar/snapshot/route';

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected response');
  return response;
}

function successResponse(results: unknown[]): AskEdgarResponse<unknown> {
  return {
    status: 'success',
    count: results.length,
    results,
  };
}

function errorResponse(error: string): AskEdgarResponse<unknown> {
  return {
    status: 'error',
    count: 0,
    results: [],
    error,
  };
}

describe('GET /api/askedgar/snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
        picture: null,
      },
    });
    fetchUnifiedSnapshotMock.mockResolvedValue({
      results: [{ name: 'Acme Biotech' }],
    });
  });

  it('returns a structured 429 when AskEdgar is fully rate limited', async () => {
    getCachedTickerDataMock.mockResolvedValue({
      ticker: 'ACME',
      fetchedAt: '2026-04-06T00:00:00.000Z',
      rawData: {
        screener: errorResponse('Rate limited — retry after 42s'),
        news: errorResponse('Rate limited — waiting for retry window'),
      },
      dataSources: [],
      warnings: [
        'Screener unavailable: Rate limited — retry after 42s',
        'News unavailable: Rate limited — waiting for retry window',
      ],
      hasAnyData: false,
    });

    const response = ensureResponse(await GET(new Request('http://localhost/api/askedgar/snapshot?ticker=acme')));
    const payload = await response.json();

    expect(response.status).toBe(429);
    expect(payload).toEqual({
      error: 'AskEdgar is temporarily rate limited. Please retry this ticker shortly.',
      warnings: [
        'Screener unavailable: Rate limited — retry after 42s',
        'News unavailable: Rate limited — waiting for retry window',
      ],
      retryHint: 'Retry in about 42 seconds.',
    });
  });

  it('returns a structured 503 when AskEdgar has no usable non-rate-limited data', async () => {
    getCachedTickerDataMock.mockResolvedValue({
      ticker: 'ACME',
      fetchedAt: '2026-04-06T00:00:00.000Z',
      rawData: {
        screener: errorResponse('503 Request failed'),
        news: errorResponse('Request timed out after 15s'),
      },
      dataSources: [],
      warnings: [
        'Screener unavailable: 503 Request failed',
        'News unavailable: Request timed out after 15s',
      ],
      hasAnyData: false,
    });

    const response = ensureResponse(await GET(new Request('http://localhost/api/askedgar/snapshot?ticker=acme')));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({
      error: 'AskEdgar did not return usable research data for this ticker right now.',
      warnings: [
        'Screener unavailable: 503 Request failed',
        'News unavailable: Request timed out after 15s',
      ],
    });
  });

  it('returns normalized data plus warnings when partial AskEdgar data exists', async () => {
    getCachedTickerDataMock.mockResolvedValue({
      ticker: 'ACME',
      fetchedAt: '2026-04-06T00:00:00.000Z',
      rawData: {
        screener: errorResponse('503 Request failed'),
        'float-outstanding': successResponse([
          {
            ticker: 'ACME',
            market_cap_final: 125000000,
            outstanding: 45000000,
            float: 12000000,
            industry: 'Biotechnology',
            country: 'United States',
          },
        ]),
      },
      dataSources: [
        { endpoint: 'screener', label: 'Screener', hasData: false, error: '503 Request failed' },
        { endpoint: 'float-outstanding', label: 'Float Outstanding', hasData: true },
      ],
      warnings: ['Screener unavailable: 503 Request failed'],
      hasAnyData: true,
    });

    const response = ensureResponse(await GET(new Request('http://localhost/api/askedgar/snapshot?ticker=acme')));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.companyName).toBe('Acme Biotech');
    expect(payload.warnings).toEqual(['Screener unavailable: 503 Request failed']);
    expect(payload.header).toMatchObject({
      marketCap: 125000000,
      outstandingShares: 45000000,
      float: 12000000,
      industry: 'Biotechnology',
      country: 'United States',
    });
    expect(payload.rawData).toBeUndefined();
  });
});

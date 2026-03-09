import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getDb: getDbMock,
}));

import { getScrapeCacheTtlMs, isUrlFreshInCache } from '@/lib/jarvis-scrape-cache';

describe('jarvis-scrape-cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.JARVIS_SCRAPE_CACHE_TTL_WEB_MS;
    delete process.env.JARVIS_SCRAPE_CACHE_TTL_HEADLINE_MS;
    delete process.env.JARVIS_SCRAPE_CACHE_TTL_API_MS;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getScrapeCacheTtlMs(web_source) returns default', () => {
    expect(getScrapeCacheTtlMs('web_source')).toBe(3_600_000);
  });

  it('getScrapeCacheTtlMs(cached_headline) returns default', () => {
    expect(getScrapeCacheTtlMs('cached_headline')).toBe(43_200_000);
  });

  it('getScrapeCacheTtlMs(trade_journal) returns 0', () => {
    expect(getScrapeCacheTtlMs('trade_journal')).toBe(0);
  });

  it('getScrapeCacheTtlMs(api_data) returns default', () => {
    expect(getScrapeCacheTtlMs('api_data')).toBe(86_400_000);
  });

  it('isUrlFreshInCache returns fresh=true within TTL', async () => {
    const now = Date.now();
    const selectMock = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => [{ lastSeenAt: new Date(now - 1_000), chunkCount: 3 }]),
      })),
    }));
    getDbMock.mockReturnValue({ select: selectMock });

    const result = await isUrlFreshInCache('https://example.com/a', 'web_source');

    expect(result.isFresh).toBe(true);
    expect(result.chunkCount).toBe(3);
    expect(result.lastSeenAt).toBeInstanceOf(Date);
  });

  it('isUrlFreshInCache returns fresh=false outside TTL', async () => {
    const now = Date.now();
    const selectMock = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => [{ lastSeenAt: new Date(now - 4_000_000), chunkCount: 2 }]),
      })),
    }));
    getDbMock.mockReturnValue({ select: selectMock });

    const result = await isUrlFreshInCache('https://example.com/a', 'web_source');

    expect(result.isFresh).toBe(false);
    expect(result.chunkCount).toBe(0);
    expect(result.lastSeenAt).toBeInstanceOf(Date);
  });

  it('isUrlFreshInCache returns fresh=false when no rows exist', async () => {
    const selectMock = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => []),
      })),
    }));
    getDbMock.mockReturnValue({ select: selectMock });

    const result = await isUrlFreshInCache('https://example.com/a', 'web_source');

    expect(result).toEqual({ isFresh: false, lastSeenAt: null, chunkCount: 0 });
  });

  it('isUrlFreshInCache returns fresh=false when db is null', async () => {
    getDbMock.mockReturnValue(null);

    const result = await isUrlFreshInCache('https://example.com/a', 'web_source');

    expect(result).toEqual({ isFresh: false, lastSeenAt: null, chunkCount: 0 });
  });
});

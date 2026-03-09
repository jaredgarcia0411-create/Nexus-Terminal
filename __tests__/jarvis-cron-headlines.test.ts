import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getMacroAllowlistDomainsMock,
  getTrustScoreForHostMock,
  ingestKnowledgeChunksMock,
  buildStructuredSourceMock,
  chunkScrapedSourceMock,
  dedupeSourceChunksMock,
  rankSourceChunksMock,
  isRobotAllowedMock,
  isUrlFreshInCacheMock,
} = vi.hoisted(() => ({
  getMacroAllowlistDomainsMock: vi.fn(),
  getTrustScoreForHostMock: vi.fn(),
  ingestKnowledgeChunksMock: vi.fn(),
  buildStructuredSourceMock: vi.fn(),
  chunkScrapedSourceMock: vi.fn(),
  dedupeSourceChunksMock: vi.fn(),
  rankSourceChunksMock: vi.fn(),
  isRobotAllowedMock: vi.fn(),
  isUrlFreshInCacheMock: vi.fn(),
}));

vi.mock('@/lib/jarvis-allowlist', () => ({
  getMacroAllowlistDomains: getMacroAllowlistDomainsMock,
  getTrustScoreForHost: getTrustScoreForHostMock,
}));

vi.mock('@/lib/jarvis-knowledge', () => ({
  ingestKnowledgeChunks: ingestKnowledgeChunksMock,
}));

vi.mock('@/lib/jarvis-scrape', () => ({
  buildStructuredSource: buildStructuredSourceMock,
  chunkScrapedSource: chunkScrapedSourceMock,
  dedupeSourceChunks: dedupeSourceChunksMock,
  rankSourceChunks: rankSourceChunksMock,
}));

vi.mock('@/lib/jarvis-robots', () => ({
  isRobotAllowed: isRobotAllowedMock,
}));

vi.mock('@/lib/jarvis-scrape-cache', () => ({
  isUrlFreshInCache: isUrlFreshInCacheMock,
}));

import { GET } from '@/app/api/jarvis/cron/headlines/route';

describe('GET /api/jarvis/cron/headlines', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;

    getMacroAllowlistDomainsMock.mockReturnValue([
      { domain: 'cnbc.com', label: 'CNBC', category: 'macro', region: 'us' },
      { domain: 'reuters.com', label: 'Reuters', category: 'macro', region: 'us' },
    ]);
    getTrustScoreForHostMock.mockReturnValue(0.85);

    buildStructuredSourceMock.mockImplementation((url: string, html: string) => ({
      url,
      title: html.includes('CNBC') ? 'CNBC Economy' : 'Reuters Markets',
      host: new URL(url).host,
      excerpt: 'excerpt',
      scrapedAt: new Date(),
      body: html,
      tickers: [],
    }));
    chunkScrapedSourceMock.mockReturnValue([
      {
        sourceUrl: 'https://www.cnbc.com/economy/',
        sourceHost: 'www.cnbc.com',
        sourceTitle: 'CNBC Economy',
        index: 0,
        startToken: 0,
        endToken: 10,
        tokenCount: 10,
        text: 'macro headline',
        hash: 'h1',
        tickers: [],
      },
    ]);
    dedupeSourceChunksMock.mockImplementation((chunks: unknown) => chunks);
    rankSourceChunksMock.mockImplementation((chunks: unknown) => chunks);
    ingestKnowledgeChunksMock.mockResolvedValue(undefined);
    isRobotAllowedMock.mockResolvedValue(true);
    isUrlFreshInCacheMock.mockResolvedValue({ isFresh: false, lastSeenAt: null, chunkCount: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 503 when CRON_SECRET is not configured', async () => {
    const response = await GET(new Request('http://localhost/api/jarvis/cron/headlines'));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error).toBe('CRON_SECRET is not configured.');
  });

  it('returns 401 when bearer token is invalid', async () => {
    process.env.CRON_SECRET = 'secret';

    const response = await GET(new Request('http://localhost/api/jarvis/cron/headlines', {
      headers: { authorization: 'Bearer wrong' },
    }));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Unauthorized');
  });

  it('continues scraping when one source fails and ingests cached headlines', async () => {
    process.env.CRON_SECRET = 'secret';

    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('<html><title>CNBC</title>macro</html>', { status: 200, headers: { 'content-type': 'text/html' } }))
      .mockResolvedValueOnce(new Response('bad gateway', { status: 502, headers: { 'content-type': 'text/plain' } }));

    const response = await GET(new Request('http://localhost/api/jarvis/cron/headlines', {
      headers: { authorization: 'Bearer secret' },
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.scraped).toBe(1);
    expect(payload.ingested).toBe(1);
    expect(payload.errors).toEqual(expect.arrayContaining(['reuters.com: HTTP 502']));
    expect(ingestKnowledgeChunksMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'system',
      sourceType: 'cached_headline',
    }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

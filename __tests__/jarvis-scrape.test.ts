import { describe, expect, it } from 'vitest';

import {
  CHUNK_TARGET_TOKENS,
  buildSourceContexts,
  buildStructuredSource,
  chunkScrapedSource,
  dedupeSourceChunks,
  rankSourceChunks,
} from '@/lib/jarvis-scrape';

describe('buildStructuredSource', () => {
  it('extracts title, metadata, and tickers from HTML', () => {
    const html = `
      <html>
        <head>
          <meta property="og:title" content="Earnings Call Notes" />
          <meta name="author" content="Market Desk" />
          <meta property="article:published_time" content="2026-03-01T12:00:00Z" />
          <title>Fallback Title</title>
        </head>
        <body>
          <p>$AAPL beat expectations while $MSFT shares held steady in premarket.</p>
        </body>
      </html>
    `;

    const source = buildStructuredSource('https://www.example.com/article', html);

    expect(source.title).toBe('Earnings Call Notes');
    expect(source.author).toBe('Market Desk');
    expect(source.publishedAt).toBe('2026-03-01T12:00:00.000Z');
    expect(source.tickers).toEqual(['AAPL', 'MSFT']);
    expect(source.host).toBe('www.example.com');
    expect(source.body).toContain('AAPL beat expectations');
  });
});

describe('chunkScrapedSource', () => {
  it('creates overlapping chunks with stable token boundaries', () => {
    const source = {
      url: 'https://example.com/article',
      title: 'Test',
      host: 'example.com',
      excerpt: '',
      scrapedAt: new Date(),
      tickers: ['AAPL'],
      body: Array.from({ length: 100 }, (_, index) => `word${index}`).join(' '),
    };

    const chunks = chunkScrapedSource(source, 32, 8);

    expect(chunks).toHaveLength(4);
    expect(chunks[0]).toMatchObject({ startToken: 0, endToken: 32, tokenCount: 32 });
    expect(chunks[1]).toMatchObject({ startToken: 24, endToken: 56, tokenCount: 32 });
    expect(chunks[2]).toMatchObject({ startToken: 48, endToken: 80, tokenCount: 32 });
    expect(chunks[3]).toMatchObject({ startToken: 72, endToken: 100, tokenCount: 28 });
    expect(chunks[0].text).toContain('word0 word1');
  });
});

describe('dedupeSourceChunks', () => {
  it('removes exact and near-duplicate chunks', () => {
    const chunks = [
      {
        sourceUrl: 'https://example.com/a',
        sourceHost: 'example.com',
        sourceTitle: 'Article A',
        index: 0,
        startToken: 0,
        endToken: 4,
        tokenCount: 4,
        text: 'alpha beta gamma delta',
        hash: 'hash-a',
        tickers: ['AAPL'],
        publishedAt: undefined,
        author: undefined,
      },
      {
        sourceUrl: 'https://example.com/a',
        sourceHost: 'example.com',
        sourceTitle: 'Article A',
        index: 1,
        startToken: 10,
        endToken: 14,
        tokenCount: 4,
        text: 'alpha beta gamma delta',
        hash: 'hash-a',
        tickers: ['AAPL'],
        publishedAt: undefined,
        author: undefined,
      },
      {
        sourceUrl: 'https://example.com/a',
        sourceHost: 'example.com',
        sourceTitle: 'Article A',
        index: 2,
        startToken: 20,
        endToken: 24,
        tokenCount: 4,
        text: 'alpha beta gamma delta epsilon',
        hash: 'hash-b',
        tickers: ['MSFT'],
        publishedAt: undefined,
        author: undefined,
      },
      {
        sourceUrl: 'https://example.com/b',
        sourceHost: 'example.com',
        sourceTitle: 'Article B',
        index: 0,
        startToken: 0,
        endToken: 3,
        tokenCount: 3,
        text: 'completely distinct signal',
        hash: 'hash-c',
        tickers: ['TSLA'],
        publishedAt: undefined,
        author: undefined,
      },
    ];

    const unique = dedupeSourceChunks(chunks);

    expect(unique).toHaveLength(2);
    expect(unique.map((chunk) => chunk.hash)).toEqual(['hash-a', 'hash-c']);
  });
});

describe('rankSourceChunks and buildSourceContexts', () => {
  it('ranks chunks by trust and recency then builds source previews', () => {
    const chunks = [
      {
        sourceUrl: 'https://www.marketwatch.com/a',
        sourceHost: 'marketwatch.com',
        sourceTitle: 'MarketWatch A',
        index: 0,
        startToken: 0,
        endToken: CHUNK_TARGET_TOKENS,
        tokenCount: CHUNK_TARGET_TOKENS,
        text: 'AAPL guidance update '.repeat(171).trim(),
        hash: 'a',
        tickers: ['AAPL'],
        publishedAt: '2026-03-06T00:00:00.000Z',
        author: 'Reporter',
      },
      {
        sourceUrl: 'https://www.sec.gov/filing',
        sourceHost: 'sec.gov',
        sourceTitle: 'SEC Filing',
        index: 0,
        startToken: 0,
        endToken: CHUNK_TARGET_TOKENS,
        tokenCount: CHUNK_TARGET_TOKENS,
        text: 'AAPL filing confirms new outlook '.repeat(120).trim(),
        hash: 'b',
        tickers: ['AAPL'],
        publishedAt: '2026-02-28T00:00:00.000Z',
        author: 'SEC',
      },
      {
        sourceUrl: 'https://www.sec.gov/filing',
        sourceHost: 'sec.gov',
        sourceTitle: 'SEC Filing',
        index: 1,
        startToken: 50,
        endToken: 50 + CHUNK_TARGET_TOKENS,
        tokenCount: CHUNK_TARGET_TOKENS,
        text: 'Another filing section with AAPL '.repeat(110).trim(),
        hash: 'c',
        tickers: ['AAPL'],
        publishedAt: '2026-02-20T00:00:00.000Z',
        author: 'SEC',
      },
    ];

    const ranked = rankSourceChunks(chunks, {
      tradeTickers: ['AAPL'],
      trustByHost: {
        'marketwatch.com': 0.8,
        'sec.gov': 1,
      },
      now: new Date('2026-03-07T00:00:00.000Z'),
    });

    expect(ranked[0].sourceHost).toBe('sec.gov');

    const sourceContexts = buildSourceContexts(ranked, 2);

    expect(sourceContexts).toHaveLength(2);
    expect(sourceContexts[0]).toMatchObject({
      url: 'https://www.sec.gov/filing',
      host: 'sec.gov',
    });
    expect(sourceContexts[0].tickers).toContain('AAPL');
  });
});

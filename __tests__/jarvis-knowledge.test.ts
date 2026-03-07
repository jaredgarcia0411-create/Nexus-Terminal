import { describe, expect, it } from 'vitest';
import { assembleKnowledgeContext } from '@/lib/jarvis-knowledge';

describe('jarvis knowledge context budget', () => {
  it('keeps highest-priority chunks within token budget', () => {
    const chunks = [
      {
        id: '1',
        sourceType: 'web_source' as const,
        sourceUrl: 'https://example.com/1',
        sourceHost: 'example.com',
        sourceTitle: 'One',
        index: 0,
        startToken: 0,
        endToken: 600,
        tokenCount: 600,
        text: 'one',
        hash: 'h1',
        relevance: 0.9,
        tickers: ['AAPL'],
        seenCount: 1,
        score: 1,
        lastSeenAt: new Date().toISOString(),
      },
      {
        id: '2',
        sourceType: 'web_source' as const,
        sourceUrl: 'https://example.com/2',
        sourceHost: 'example.com',
        sourceTitle: 'Two',
        index: 1,
        startToken: 600,
        endToken: 1200,
        tokenCount: 600,
        text: 'two',
        hash: 'h2',
        relevance: 0.8,
        tickers: ['AAPL'],
        seenCount: 1,
        score: 0.9,
        lastSeenAt: new Date().toISOString(),
      },
    ];

    const result = assembleKnowledgeContext(chunks, 1200);

    expect(result.totalTokens).toBe(600);
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].id).toBe('1');
    expect(result.truncated).toBe(true);
    expect(result.droppedCount).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';

import { buildNewsFeed, buildNewsFeedFromArrays } from '@/lib/agents/news-formatter';

const NOW_MS = Date.parse('2026-04-15T12:00:00.000Z');

function expectCleanHeadlines(headlines: string[]) {
  for (const headline of headlines) {
    expect(headline).not.toBe('');
    expect(headline).not.toBe('(untitled)');
  }
}

describe('news formatter', () => {
  it('maps EODHD news articles into the feed contract', () => {
    const feed = buildNewsFeed({
      news: {
        results: [{
          title: 'Company launches new platform',
          content: 'Detailed article body that should stay in the summary field.',
          date: '2026-04-15',
          link: 'https://example.com/news',
          tags: ['Product Launches'],
          sentiment: { pos: 0.8, neg: 0.1, neu: 0.1 },
        }],
      },
    }, { nowMs: NOW_MS });

    expect(feed).toEqual([{
      headline: 'Company launches new platform',
      summary: 'Detailed article body that should stay in the summary field.',
      date: '2026-04-15',
      formType: 'news',
      url: 'https://example.com/news',
      tags: ['Product Launches'],
      isNews: true,
      isFiling: false,
      sentiment: 'positive',
    }]);
    expectCleanHeadlines(feed.map((item) => item.headline));
  });

  it('falls back to a generic headline for EODHD rows without a title', () => {
    const news = [{
      content: 'Article body without a usable headline.',
      date: '2026-04-15',
      link: 'https://example.com/missing-title',
    }];

    const feed = buildNewsFeedFromArrays(news, { nowMs: NOW_MS });

    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({
      headline: 'News item',
      summary: 'Article body without a usable headline.',
      formType: 'news',
      isNews: true,
      isFiling: false,
    });
    expectCleanHeadlines(feed.map((item) => item.headline));
  });

  it('reads neutral and negative EODHD sentiment labels', () => {
    const feed = buildNewsFeed({
      news: {
        results: [
          {
            title: 'Neutral item',
            content: 'Mostly balanced article.',
            date: '2026-04-15',
            link: 'https://example.com/neutral',
            sentiment: { pos: 0.2, neg: 0.2, neu: 0.6 },
          },
          {
            title: 'Negative item',
            content: 'Risk-heavy article.',
            date: '2026-04-14',
            link: 'https://example.com/negative',
            sentiment: { pos: 0.1, neg: 0.7, neu: 0.2 },
          },
        ],
      },
    }, { nowMs: NOW_MS });

    expect(feed.map((item) => item.sentiment)).toEqual(['neutral', 'negative']);
  });

  it('filters out items older than maxAgeDays', () => {
    const feed = buildNewsFeed({
      news: {
        results: [
          {
            title: 'Older article',
            content: 'Older article that should be filtered out',
            date: '2026-03-01',
            link: 'https://example.com/old',
          },
          {
            title: 'Fresh article',
            content: 'Fresh article that should remain',
            date: '2026-04-14',
            link: 'https://example.com/new',
          },
        ],
      },
    }, {
      nowMs: NOW_MS,
      maxAgeDays: 30,
    });

    expect(feed).toHaveLength(1);
    expect(feed[0]?.headline).toBe('Fresh article');
    expectCleanHeadlines(feed.map((item) => item.headline));
  });

  it('deduplicates EODHD articles by URL', () => {
    const feed = buildNewsFeed({
      news: {
        results: [
          {
            title: 'First copy',
            content: 'First copy',
            date: '2026-04-15',
            link: 'https://example.com/dup-1',
          },
          {
            title: 'Second copy',
            content: 'Second copy',
            date: '2026-04-15',
            link: 'https://example.com/dup-1',
          },
        ],
      },
    }, { nowMs: NOW_MS });

    expect(feed).toHaveLength(1);
    expect(feed[0]?.headline).toBe('First copy');
    expectCleanHeadlines(feed.map((item) => item.headline));
  });

  it('returns an empty array for empty rawData', () => {
    expect(buildNewsFeed({}, { nowMs: NOW_MS })).toEqual([]);
  });
});

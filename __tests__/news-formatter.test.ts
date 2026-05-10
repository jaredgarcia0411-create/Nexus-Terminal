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
  it('uses the AskEdgar title for news items when present', () => {
    const feed = buildNewsFeed({
      news: {
        results: [{
          form_type: 'news',
          title: 'Company launches new platform',
          body: 'Detailed article body that should stay in the summary field.',
          filed_at: '2026-04-15',
          document_url: 'https://example.com/news',
          tags: ['Product Launches'],
        }],
      },
      'filing-titles': { results: [] },
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
    }]);
    expectCleanHeadlines(feed.map((item) => item.headline));
  });

  it('uses the inline headline on filing rows from the news endpoint', () => {
    // The /v1/news endpoint now includes a `headline` field on filing rows
    // (JMT 2026-05-10), so we no longer need a separate filing-titles call.
    const news = [{
      accession_number: '000123',
      form_type: '8-K',
      headline: 'Announces $50M convertible financing facility',
      summary: 'Convertible financing summary',
      filed_at: '2026-04-15',
      document_url: 'https://sec.test/8k',
    }];

    const feed = buildNewsFeedFromArrays(news, { nowMs: NOW_MS });

    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({
      headline: 'Announces $50M convertible financing facility',
      summary: 'Convertible financing summary',
      formType: '8-K',
      isNews: false,
      isFiling: true,
    });
    expectCleanHeadlines(feed.map((item) => item.headline));
  });

  it('falls back to the filing summary when no filing-title match exists', () => {
    const feed = buildNewsFeed({
      news: {
        results: [{
          accession_number: '000124',
          form_type: '8-K',
          summary: 'Company pivots to GPU-as-a-Service',
          filed_at: '2026-04-14',
        }],
      },
      'filing-titles': { results: [] },
    }, { nowMs: NOW_MS });

    expect(feed).toHaveLength(1);
    expect(feed[0]?.headline).toBe('Company pivots to GPU-as-a-Service');
    expectCleanHeadlines(feed.map((item) => item.headline));
  });

  it('falls back to the form-type label when a filing has no better headline source', () => {
    const feed = buildNewsFeed({
      news: {
        results: [{
          accession_number: '000125',
          form_type: '8-K',
          filed_at: '2026-04-14',
        }],
      },
      'filing-titles': { results: [] },
    }, { nowMs: NOW_MS });

    expect(feed).toHaveLength(1);
    expect(feed[0]?.headline).toBe('8-K filing');
    expectCleanHeadlines(feed.map((item) => item.headline));
  });

  it('filters out items older than maxAgeDays', () => {
    const feed = buildNewsFeed({
      news: {
        results: [
          {
            accession_number: 'old-1',
            form_type: '8-K',
            summary: 'Older filing that should be filtered out',
            filed_at: '2026-03-01',
          },
          {
            accession_number: 'new-1',
            form_type: '8-K',
            summary: 'Fresh filing that should remain',
            filed_at: '2026-04-14',
          },
        ],
      },
      'filing-titles': { results: [] },
    }, {
      nowMs: NOW_MS,
      maxAgeDays: 30,
    });

    expect(feed).toHaveLength(1);
    expect(feed[0]?.headline).toBe('Fresh filing that should remain');
    expectCleanHeadlines(feed.map((item) => item.headline));
  });

  it('deduplicates filings by accession number', () => {
    const feed = buildNewsFeed({
      news: {
        results: [
          {
            accession_number: 'dup-1',
            form_type: '8-K',
            summary: 'First copy',
            filed_at: '2026-04-15',
            document_url: 'https://sec.test/dup-1',
          },
          {
            accession_number: 'dup-1',
            form_type: '8-K',
            summary: 'Second copy',
            filed_at: '2026-04-15',
            document_url: 'https://sec.test/dup-1-b',
          },
        ],
      },
      'filing-titles': { results: [] },
    }, { nowMs: NOW_MS });

    expect(feed).toHaveLength(1);
    expect(feed[0]?.headline).toBe('First copy');
    expectCleanHeadlines(feed.map((item) => item.headline));
  });

  it('returns an empty array for empty rawData', () => {
    expect(buildNewsFeed({}, { nowMs: NOW_MS })).toEqual([]);
  });
});

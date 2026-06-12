import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  getDb: vi.fn(() => null),
}));

vi.mock('@/lib/sec/client', () => ({
  secFetchJson: vi.fn(),
  secFetchText: vi.fn(),
}));

import { extractPrHeadline, enrichFilingHeadlines } from '@/lib/sec/filing-headline';
import { secFetchJson, secFetchText } from '@/lib/sec/client';
import type { SecFiling } from '@/lib/sec/submissions';

describe('SEC PR headline extraction', () => {
  it('returns a clean GlobeNewswire-style headline before the dateline', () => {
    const html = `
      <html>
        <body>
          <p>Global Mofy AI Announces Reverse Split Effective June 10, 2026</p>
          <p>NEW YORK, June 09, 2026 (GLOBE NEWSWIRE) -- Global Mofy AI Limited today announced...</p>
        </body>
      </html>
    `;

    expect(extractPrHeadline(html)).toBe('Global Mofy AI Announces Reverse Split Effective June 10, 2026');
  });

  it('extracts the headline tail from a dateline line', () => {
    const html = '<p>NEW YORK, June 09, 2026 (GLOBE NEWSWIRE) -- Acme Corp announces 1-for-10 reverse split</p>';

    expect(extractPrHeadline(html)).toBe('Acme Corp announces 1-for-10 reverse split');
  });

  it('returns null when the document only contains boilerplate', () => {
    const html = `
      <p>EXHIBIT 99.1</p>
      <p>FOR IMMEDIATE RELEASE</p>
      <p>123 Main St.</p>
    `;

    expect(extractPrHeadline(html)).toBeNull();
  });

  it('returns h1 headlines and truncates overly long headlines', () => {
    const clean = '<h1>Big Headline Here For The Press Release</h1>';
    expect(extractPrHeadline(clean)).toBe('Big Headline Here For The Press Release');

    const longHeadline = `Acme Corp Announces ${'Very Important '.repeat(20)}Press Release`;
    const truncated = extractPrHeadline(`<h1>${longHeadline}</h1>`);
    expect(truncated).not.toBeNull();
    expect(truncated).toHaveLength(220);
    expect(longHeadline.startsWith(truncated ?? '')).toBe(true);
  });
});

describe('SEC PR headline enrichment', () => {
  it('short-circuits without a database and performs no fetches', async () => {
    const filings: SecFiling[] = [{
      accession_number: '0000000000-26-000001',
      cik: '0000000000',
      ticker_requested: 'GMM',
      ticker_at_ingest: 'GMM',
      form_type: '6-K',
      filed_at: '2026-06-09',
      report_date: null,
      acceptance_datetime: null,
      headline: 'foreign issuer report',
      url: '',
      primary_document: null,
      primary_doc_description: null,
      items: null,
      archive_source: null,
    }];

    await expect(enrichFilingHeadlines(filings)).resolves.toEqual(new Map());
    expect(secFetchJson).not.toHaveBeenCalled();
    expect(secFetchText).not.toHaveBeenCalled();
  });
});

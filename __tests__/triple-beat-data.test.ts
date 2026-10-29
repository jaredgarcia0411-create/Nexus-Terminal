import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchMassiveAggregateBars, fetchTickerNewsBetween } from '@/lib/massive-market';
import { fetchEodhdNews } from '@/lib/eodhd';
import { fetchEarningsFilerTickers, fetchEarningsNews, fetchExtendedHoursStats, fetchPressReleaseText, findEarningsFiling, isEarningsHeadline } from '@/lib/triple-beat/data';
import { secFetchText } from '@/lib/sec/client';
import { getTickersForCiks } from '@/lib/sec/cik-map';
import { fetchPressReleaseHtml } from '@/lib/sec/filing-headline';
import type { SecFiling } from '@/lib/sec/submissions';

vi.mock('@/lib/massive-market', () => ({ fetchMassiveAggregateBars: vi.fn(), fetchTickerNewsBetween: vi.fn() }));
vi.mock('@/lib/eodhd', () => ({ fetchEodhdNews: vi.fn() }));
vi.mock('@/lib/sec/filing-headline', () => ({ fetchPressReleaseHtml: vi.fn() }));
vi.mock('@/lib/sec/client', () => ({ secFetchText: vi.fn() }));
vi.mock('@/lib/sec/cik-map', () => ({ getTickersForCiks: vi.fn() }));
const start = Date.parse('2026-10-28T20:00:00Z');
const end = Date.parse('2026-10-29T13:00:00Z');
const filing = (overrides: Partial<SecFiling> = {}): SecFiling => ({
  accession_number: '0001171843-26-006957', cik: '0001513761', ticker_requested: 'NCLH', ticker_at_ingest: 'NCLH',
  form_type: '8-K', filed_at: '2026-10-29', report_date: null, acceptance_datetime: '2026-10-29T11:00:29.000Z',
  headline: '', url: '', primary_document: null, primary_doc_description: null, items: '2.02,9.01', archive_source: null,
  ...overrides,
});

describe('Triple Beat data', () => {
  beforeEach(() => vi.resetAllMocks());
  it('selects exact earnings forms inside the window and stops after short feed pages', async () => {
    const entry = (cik: string, form: string, items: string, accepted = '2026-10-29T07:00:29-04:00') => `<entry>
      <title>${form} - Company (${cik}) (Filer)</title>
      <summary type="html">&lt;br&gt;${items}</summary>
      <updated>${accepted}</updated>
      <category scheme="https://www.sec.gov/" label="form type" term="${form}"/>
    </entry>`;
    vi.mocked(secFetchText).mockImplementation(async (url) => `<feed>${url.includes('type=8-K') ? [
      entry('0000000001', '8-K', 'Item 2.02: Results of Operations and Financial Condition'),
      entry('0000000002', '8-K', 'Item 5.02: Directors'),
      entry('0000000003', '8-K/A', 'Item 2.02: Results of Operations'),
      entry('0000000005', '8-K', 'Item 2.02: Results of Operations', '2026-10-28T15:59:59-04:00'),
    ].join('') : entry('0000000004', '6-K', '')}</feed>`);
    vi.mocked(getTickersForCiks).mockImplementation(async (ciks) => [...ciks]);

    expect(await fetchEarningsFilerTickers(start, end)).toEqual(['0000000001', '0000000004']);
    expect(secFetchText).toHaveBeenCalledTimes(2);
    expect(secFetchText).toHaveBeenNthCalledWith(1, expect.stringContaining('&type=8-K&start=0'));
    expect(secFetchText).toHaveBeenNthCalledWith(2, expect.stringContaining('&type=6-K&start=0'));
  });
  it('propagates feed failures rather than reporting no candidates', async () => {
    vi.mocked(secFetchText).mockRejectedValue(new Error('SEC unavailable'));
    await expect(fetchEarningsFilerTickers(start, end)).rejects.toThrow('SEC unavailable');
    expect(getTickersForCiks).not.toHaveBeenCalled();
  });
  it('pages full feeds and deduplicates filers across pages', async () => {
    const entry = (cik: string) => `<entry><title>8-K - Company (${cik}) (Filer)</title>
      <summary>Item 2.02: Results of Operations</summary><updated>2026-10-29T07:00:00-04:00</updated>
      <category label="form type" term="8-K"/></entry>`;
    vi.mocked(secFetchText).mockResolvedValueOnce(`<feed>${entry('0000000001').repeat(100)}</feed>`)
      .mockResolvedValueOnce(`<feed>${entry('0000000001')}${entry('0000000002')}</feed>`)
      .mockResolvedValueOnce('<feed></feed>');
    vi.mocked(getTickersForCiks).mockImplementation(async (ciks) => [...ciks]);
    expect(await fetchEarningsFilerTickers(start, end)).toEqual(['0000000001', '0000000002']);
    expect(secFetchText).toHaveBeenCalledTimes(3);
    expect(secFetchText).toHaveBeenNthCalledWith(2, expect.stringContaining('&type=8-K&start=100'));
  });
  it('combines AH and PM stats while excluding the regular session', async () => {
    vi.mocked(fetchMassiveAggregateBars).mockResolvedValue([
      { t: Date.parse('2026-10-28T20:30:00Z'), h: 22, l: 21, c: 21.8, v: 100000 },
      { t: Date.parse('2026-10-29T09:00:00Z'), h: 23.4, l: 22.6, c: 23, v: 300000 },
      { t: Date.parse('2026-10-29T12:59:00Z'), h: 23.2, l: 22.9, c: 23.1, v: 50000 },
      { t: Date.parse('2026-10-29T13:30:00Z'), h: 30, l: 10, c: 25, v: 9 },
    ]);
    expect(await fetchExtendedHoursStats('NCLH', '2026-10-28', '2026-10-29', end)).toEqual({
      last: 23.1, high: 23.4, low: 21, volume: 450000, premarketHigh: 23.4, premarketLow: 22.6,
    });
    expect(fetchMassiveAggregateBars).toHaveBeenCalledWith({ ticker: 'NCLH', multiplier: '1', timespan: 'minute', from: String(start), to: String(end) });
  });
  it('requires premarket bars and caps a late request at the open', async () => {
    vi.mocked(fetchMassiveAggregateBars).mockResolvedValue([{ t: start + 60000, h: 22, l: 21, c: 22 }]);
    expect(await fetchExtendedHoursStats('NCLH', '2026-10-28', '2026-10-29', Infinity)).toBeNull();
    expect(fetchMassiveAggregateBars).toHaveBeenCalledWith(expect.objectContaining({ to: String(Date.parse('2026-10-29T13:30:00Z')) }));
  });
  it('selects an 8-K 2.02 using true UTC acceptance and falls back to 6-K', () => {
    const valid = filing();
    const other = filing({ items: '5.02,9.01' });
    const old = filing({ acceptance_datetime: '2026-07-30T10:50:20.000Z' });
    const foreign = filing({ form_type: '6-K', items: null });
    expect(findEarningsFiling([foreign, other, old, valid], start, end)).toBe(valid);
    expect(findEarningsFiling([other, old, foreign], start, end)).toBe(foreign);
    expect(findEarningsFiling([other, old, filing({ acceptance_datetime: null })], start, end)).toBeNull();
  });
  it('recognizes earnings headlines', () => {
    expect(isEarningsHeadline('SK hynix Announces 3Q26 Financial Results')).toBe(true);
    expect(isEarningsHeadline('Norwegian Cruise Line (NCLH) Q3 Earnings and Revenues Beat Estimates')).toBe(true);
    expect(isEarningsHeadline('Marvell nears deal to acquire Lumentum')).toBe(false);
  });
  it('maps news, filters EODHD timestamps, truncates content, and tolerates Massive failure', async () => {
    vi.mocked(fetchTickerNewsBetween).mockResolvedValue([{ title: 'Earnings', description: 'Beat estimates' }]);
    vi.mocked(fetchEodhdNews).mockResolvedValue({ status: 'success', count: 3, results: [
      { title: 'Results', content: 'x'.repeat(2000), date: '2026-10-29T12:00:00Z' },
      { title: 'Late', date: '2026-10-29T14:00:00Z' }, { title: 'Old', date: '2026-10-28T19:00:00Z' },
    ] });
    const expected = [
      { source: 'massive', title: 'Earnings', text: 'Beat estimates' },
      { source: 'eodhd', title: 'Results', text: 'x'.repeat(1500) },
    ];
    expect(await fetchEarningsNews('NCLH', start, end)).toEqual(expected);
    expect(fetchTickerNewsBetween).toHaveBeenCalledWith('NCLH', new Date(start).toISOString(), new Date(end).toISOString());
    expect(fetchEodhdNews).toHaveBeenCalledWith('NCLH', 20, { from: '2026-10-28', to: '2026-10-29' });
    vi.mocked(fetchTickerNewsBetween).mockRejectedValue(new Error('offline'));
    expect(await fetchEarningsNews('NCLH', start, end)).toEqual(expected.slice(1));
  });
  it('strips and caps press releases, with empty text for missing exhibits', async () => {
    vi.mocked(fetchPressReleaseHtml).mockResolvedValue(`<p>${'x'.repeat(13000)}</p>`);
    expect(await fetchPressReleaseText(filing())).toHaveLength(12000);
    vi.mocked(fetchPressReleaseHtml).mockResolvedValue(null);
    expect(await fetchPressReleaseText(filing())).toBe('');
  });
});

import { fetchEodhdNews } from '@/lib/eodhd';
import { fetchMassiveAggregateBars, fetchTickerNewsBetween } from '@/lib/massive-market';
import { stripFilingBodyHtml } from '@/lib/sec/filing-body';
import { fetchPressReleaseHtml } from '@/lib/sec/filing-headline';
import type { SecFiling } from '@/lib/sec/submissions';
import { nyDateTimeToEpoch } from '@/lib/time-utils';

const PRESS_RELEASE_MAX_CHARS = 12_000;
const NEWS_TEXT_MAX_CHARS = 1_500;
const EARNINGS_HEADLINE_RE = /\b(earnings|financial results|quarterly results|EPS)\b/i;

export interface ExtendedHoursStats {
  last: number;
  high: number;
  low: number;
  volume: number;
  premarketHigh: number;
  premarketLow: number;
}

export interface NewsItem {
  source: 'massive' | 'eodhd';
  title: string;
  text: string;
}

// Split-adjusted 1-minute bars from `priorSession` 16:00 ET (after-hours) through `date` premarket,
// ending at the earlier of `untilMs` and the 09:30 open. high/low/volume span both sessions.
export async function fetchExtendedHoursStats(
  ticker: string,
  priorSession: string,
  date: string,
  untilMs: number,
): Promise<ExtendedHoursStats | null> {
  const start = nyDateTimeToEpoch(priorSession, '16:00:00');
  const premarketStart = nyDateTimeToEpoch(date, '04:00:00');
  const open = nyDateTimeToEpoch(date, '09:30:00');
  if (start == null || premarketStart == null || open == null) return null;

  const bars = (await fetchMassiveAggregateBars({
    ticker,
    multiplier: '1',
    timespan: 'minute',
    from: String(start),
    to: String(Math.min(untilMs, open)),
  })).filter((bar) => Number(bar.t) >= start && Number(bar.t) < open
    && [bar.h, bar.l, bar.c].every((value) => value != null && Number.isFinite(Number(value))));
  const premarket = bars.filter((bar) => Number(bar.t) >= premarketStart);
  if (premarket.length === 0) return null;

  return {
    last: Number(premarket[premarket.length - 1].c),
    high: Math.max(...bars.map((bar) => Number(bar.h))),
    low: Math.min(...bars.map((bar) => Number(bar.l))),
    volume: bars.reduce((sum, bar) => sum + Number(bar.v ?? 0), 0),
    premarketHigh: Math.max(...premarket.map((bar) => Number(bar.h))),
    premarketLow: Math.min(...premarket.map((bar) => Number(bar.l))),
  };
}

// 8-K item 2.02 is an exact earnings signal; foreign filers' 6-Ks carry no item codes, so callers
// must confirm a 6-K with an earnings headline.
export function findEarningsFiling(filings: SecFiling[], startMs: number, endMs: number): SecFiling | null {
  const inWindow = filings.filter((filing) => {
    const accepted = Date.parse(filing.acceptance_datetime ?? '');
    return accepted >= startMs && accepted <= endMs;
  });
  return inWindow.find((filing) => filing.form_type === '8-K'
    && (filing.items ?? '').split(',').map((item) => item.trim()).includes('2.02'))
    ?? inWindow.find((filing) => filing.form_type === '6-K')
    ?? null;
}

export function isEarningsHeadline(title: string): boolean {
  return EARNINGS_HEADLINE_RE.test(title);
}

export async function fetchPressReleaseText(filing: SecFiling): Promise<string> {
  const html = await fetchPressReleaseHtml(filing.cik, filing.accession_number);
  return html ? stripFilingBodyHtml(html).slice(0, PRESS_RELEASE_MAX_CHARS) : '';
}

export async function fetchEarningsNews(ticker: string, startMs: number, endMs: number): Promise<NewsItem[]> {
  const [massive, eodhd] = await Promise.all([
    fetchTickerNewsBetween(ticker, new Date(startMs).toISOString(), new Date(endMs).toISOString()).catch(() => []),
    fetchEodhdNews(ticker, 20, {
      from: new Date(startMs).toISOString().slice(0, 10),
      to: new Date(endMs).toISOString().slice(0, 10),
    }),
  ]);
  const eodhdItems = (eodhd.results as Array<{ date?: string; title?: string; content?: string }>).filter((item) => {
    const published = Date.parse(item.date ?? '');
    return published >= startMs && published <= endMs;
  });
  return [
    ...massive.map((article): NewsItem => ({ source: 'massive', title: article.title ?? '', text: article.description ?? '' })),
    ...eodhdItems.map((item): NewsItem => ({
      source: 'eodhd', title: item.title ?? '', text: (item.content ?? '').slice(0, NEWS_TEXT_MAX_CHARS),
    })),
  ].filter((item) => item.title);
}

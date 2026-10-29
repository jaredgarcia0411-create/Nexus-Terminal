/**
 * triple-beat-replay.ts
 *
 * Replay the Triple Beat Earnings scorecard over historical sessions and export CSV outcomes.
 * Reads MASSIVE_API_KEY, EODHD_API_KEY, BACKGROUND_LLM_* and DATABASE_URL (CIK map) from .env.local.
 * Usage: npx tsx scripts/triple-beat-replay.ts --from 2024-11-01 --to 2026-10-15 [--out /path/file.csv]
 *
 * Entry is a break of the premarket high, filled at the open when it gaps above. A day that touches the
 * stop counts as stopped before any target. Filings, news and premarket data stop at 09:00 ET on the
 * trade date, matching the live cron's default run time. LLM earnings reads are cached in
 * ~/triple-beat-llm-cache.json so reruns only call the LLM for new ticker/dates. Tickers missing from
 * today's SEC CIK map (delisted/renamed) are skipped.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Papa from 'papaparse';
import { fetchGroupedDailyAggregates, fetchSplitHistory, type DailyOhlcBar } from '@/lib/massive-market';
import { addCalendarDays, fetchDailyBars } from '@/lib/parabolic/data';
import { getRecentFilings, type SecFiling } from '@/lib/sec/submissions';
import { buildEarningsEvidence, classifyEarnings, UNKNOWN_EARNINGS_READ, type EarningsRead } from '@/lib/triple-beat/classify';
import { fetchEarningsNews, fetchExtendedHoursStats, fetchPressReleaseText, findEarningsFiling, isEarningsHeadline } from '@/lib/triple-beat/data';
import { evaluateTripleBeatSetup, gapBucket, measureTripleBeatOutcome, passesReplayPrefilter } from '@/lib/triple-beat/scan';
import { getNextTradingSession, getPreviousTradingSession, nyDateTimeToEpoch } from '@/lib/time-utils';

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf('--' + name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const from = readArg('from');
  const to = readArg('to');
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to
    || !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to))
    || new Date(from).toISOString().slice(0, 10) !== from || new Date(to).toISOString().slice(0, 10) !== to) {
    console.error('Usage: npx tsx scripts/triple-beat-replay.ts --from 2024-11-01 --to 2026-10-15 [--out /path/file.csv]');
    process.exit(1);
  }
  const out = readArg('out') ?? join(homedir(), `triple-beat-replay-${from}-to-${to}.csv`);
  let cursor = from;
  for (let i = 0; i < 25; i += 1) {
    const previous = getPreviousTradingSession(cursor);
    if (!previous) break;
    cursor = previous;
  }
  const windows = new Map<string, DailyOhlcBar[]>();
  const candidates: Array<{ ticker: string; date: string }> = [];
  let datesChecked = 0;
  for (let date: string | null = cursor; date && date <= to; date = getNextTradingSession(date)) {
    const bars = await fetchGroupedDailyAggregates(date, false);
    for (const bar of bars) {
      const window = windows.get(bar.ticker) ?? [];
      if (date >= from && passesReplayPrefilter(window, bar.open)) candidates.push({ ticker: bar.ticker, date });
      window.push({ date, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume, vwap: bar.vwap });
      while (window.length > 20) window.shift();
      windows.set(bar.ticker, window);
    }
    datesChecked += 1;
    if (datesChecked % 25 === 0) console.log(`pass 1: ${date} (${candidates.length} candidates)`);
  }

  const cachePath = join(homedir(), 'triple-beat-llm-cache.json');
  const llmCache: Record<string, EarningsRead> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
  const sinceDays = Math.ceil((Date.now() - Date.parse(from)) / 86_400_000) + 10;
  const filingsByTicker = new Map<string, Promise<SecFiling[]>>();
  const filingsFor = (ticker: string) => {
    if (!filingsByTicker.has(ticker)) {
      filingsByTicker.set(ticker, getRecentFilings(ticker, { limit: 5000, sinceDays, includeArchives: true }).then((result) => result.results));
    }
    return filingsByTicker.get(ticker)!;
  };
  let newLlmReads = 0;

  const rounded = (value: number | null | undefined): number | '' => value == null ? '' : Number(value.toFixed(2));
  const rows = [];
  for (let offset = 0; offset < candidates.length; offset += 10) {
    const results = await Promise.allSettled(candidates.slice(offset, offset + 10).map(async ({ ticker, date }) => {
      const priorSession = getPreviousTradingSession(date)!;
      const windowStart = nyDateTimeToEpoch(priorSession, '16:00:00')!;
      const windowEnd = nyDateTimeToEpoch(date, '09:00:00')!;
      const filing = findEarningsFiling(await filingsFor(ticker), windowStart, windowEnd);
      if (!filing) return null;
      const [bars, extended, splits] = await Promise.all([
        fetchDailyBars(ticker, addCalendarDays(date, -400), addCalendarDays(date, 100)),
        fetchExtendedHoursStats(ticker, priorSession, date, windowEnd),
        fetchSplitHistory(ticker).catch(() => []),
      ]);
      if (!extended) return null;
      // Same split rule as scripts/parabolic-replay.ts: undo splits executed after `date`.
      const factor = splits.find((split) => split.executionDate > date)?.factor ?? 1;
      const asOfBars = bars.map((bar) => ({
        ...bar,
        open: bar.open / factor,
        high: bar.high / factor,
        low: bar.low / factor,
        close: bar.close / factor,
        volume: bar.volume * factor,
        vwap: bar.vwap == null ? null : bar.vwap / factor,
      }));
      const asOfExtended = {
        last: extended.last / factor, high: extended.high / factor, low: extended.low / factor,
        volume: extended.volume * factor, premarketHigh: extended.premarketHigh / factor, premarketLow: extended.premarketLow / factor,
      };
      const history = asOfBars.filter((bar) => bar.date < date);
      const sessions = asOfBars.filter((bar) => bar.date >= date);
      if (sessions[0]?.date !== date) return null;
      if (!evaluateTripleBeatSetup(history, asOfExtended, UNKNOWN_EARNINGS_READ)?.qualified) return null;
      const news = await fetchEarningsNews(ticker, windowStart, windowEnd);
      if (filing.form_type === '6-K' && !news.some((item) => isEarningsHeadline(item.title))) return null;
      const key = `${ticker}:${date}`;
      let earnings = llmCache[key];
      if (!earnings) {
        const read = await classifyEarnings(ticker, buildEarningsEvidence(await fetchPressReleaseText(filing), news));
        newLlmReads += 1;
        if (read) llmCache[key] = read;
        earnings = read ?? UNKNOWN_EARNINGS_READ;
      }
      const setup = evaluateTripleBeatSetup(history, asOfExtended, earnings)!;
      const { metrics, plan } = setup;
      const outcome = plan ? measureTripleBeatOutcome(history, plan, sessions) : null;
      return {
        date, ticker, gapBucket: gapBucket(metrics.gapPct), grade: setup.grade, score: setup.score,
        strictTripleBeat: setup.strictTripleBeat,
        epsBeat: earnings.epsBeat, revenueBeat: earnings.revenueBeat, guidance: earnings.guidance,
        mixedCatalyst: earnings.mixedCatalyst, note: earnings.note, filingForm: filing.form_type,
        gapPct: rounded(metrics.gapPct), holdPct: rounded(metrics.holdPct),
        extendedVolumeRatio: rounded(metrics.extendedVolumeRatio), baseRangePct: rounded(metrics.baseRangePct), runUpPct: rounded(metrics.runUpPct),
        clearsBaseHigh: setup.scoreItems.find((item) => item.label === 'Clears 3-month high')?.status ?? '',
        avgDollarVolume20: rounded(metrics.avgDollarVolume20), riskAtr: rounded(plan?.riskAtr),
        riskFraction: rounded(plan?.riskFraction), entry: rounded(plan?.entry), stop: rounded(plan?.stop), splitFactor: factor,
        triggered: outcome?.triggered ?? '', fill: rounded(outcome?.fill), stoppedOutDay0: outcome?.stoppedOutDay0 ?? '',
        dayR: rounded(outcome?.dayR), hit2R: outcome?.hit2R ?? '', runnerR: rounded(outcome?.runnerR), totalR: rounded(outcome?.totalR),
        daysHeld: rounded(outcome?.daysHeld), openAtEnd: outcome?.openAtEnd ?? '', mfe20R: rounded(outcome?.mfe20R), mae20R: rounded(outcome?.mae20R),
      };
    }));
    for (const [index, result] of results.entries()) {
      if (result.status === 'fulfilled') {
        if (result.value) rows.push(result.value);
      } else {
        console.warn('triple beat replay ticker failed', candidates[offset + index], result.reason);
      }
    }
    writeFileSync(cachePath, JSON.stringify(llmCache));
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || b.score - a.score);
  writeFileSync(out, Papa.unparse(rows));
  const summarize = (label: string, group: Array<{ dayR: number | ''; totalR: number | '' }>) => {
    const traded = group.filter((row) => typeof row.totalR === 'number');
    const wins = traded.filter((row) => Number(row.totalR) > 0).length;
    const average = (key: 'dayR' | 'totalR') => (traded.length
      ? (traded.reduce((sum, row) => sum + Number(row[key]), 0) / traded.length).toFixed(2) : 'n/a');
    console.log(`${label}: ${group.length} setups, ${traded.length} triggered, win rate ${traded.length ? (100 * wins / traded.length).toFixed(1) + '%' : 'n/a'}, avg dayR ${average('dayR')}, avg totalR ${average('totalR')}`);
  };
  for (const grade of ['A+', 'A', 'B', 'Pass']) summarize(`Grade ${grade}`, rows.filter((row) => row.grade === grade));
  for (const bucket of ['4-7.9', '8-9.9', '10+']) summarize(`Gap ${bucket}%`, rows.filter((row) => row.gapBucket === bucket));
  summarize('Strict triple beat', rows.filter((row) => row.strictTripleBeat === true));
  console.log(`New LLM reads: ${newLlmReads} (cache: ${cachePath})`);
  console.log(`Output: ${out}`);
}

void main().catch((error) => { console.error(error); process.exit(1); });

/**
 * parabolic-replay.ts
 *
 * Replay the parabolic short scorecard over historical sessions and export CSV outcomes.
 * Reads MASSIVE_API_KEY from .env.local.
 * Usage: npx tsx scripts/parabolic-replay.ts --from 2024-11-01 --to 2026-10-15 [--out /path/file.csv]
 *
 * Entry uses the open as a proxy for a confirmed intraday trigger. A touched stop
 * counts as -1R; borrow fees, locates, and slippage are not modeled. Dates within
 * about two weeks of today have fewer forward sessions. Opening volume climax
 * is not measured, so the maximum score remains 17.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Papa from 'papaparse';
import { fetchGroupedDailyAggregates, fetchSharesOutstanding, fetchSplitHistory, type DailyOhlcBar } from '@/lib/massive-market';
import { addCalendarDays, fetchDailyBars, fetchPremarketStats } from '@/lib/parabolic/data';
import { MIN_HISTORY_BARS, evaluateParabolicSetup, measureReplayOutcome, passesReplayPrefilter } from '@/lib/parabolic/scan';
import { getNextTradingSession, getPreviousTradingSession } from '@/lib/time-utils';

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
    console.error('Usage: npx tsx scripts/parabolic-replay.ts --from 2024-11-01 --to 2026-10-15 [--out /path/file.csv]');
    process.exit(1);
  }
  const out = readArg('out') ?? join(homedir(), `parabolic-replay-${from}-to-${to}.csv`);
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
      while (window.length > MIN_HISTORY_BARS) window.shift();
      windows.set(bar.ticker, window);
    }
    datesChecked += 1;
    if (datesChecked % 25 === 0) console.log(`pass 1: ${date} (${candidates.length} candidates)`);
  }

  const rounded = (value: number | null | undefined) => value == null ? '' : Number(value.toFixed(2));
  const rows = [];
  for (let offset = 0; offset < candidates.length; offset += 10) {
    const results = await Promise.allSettled(candidates.slice(offset, offset + 10).map(async ({ ticker, date }) => {
      const [bars, premarket, sharesOutstanding, splits] = await Promise.all([
        fetchDailyBars(ticker, addCalendarDays(date, -120), addCalendarDays(date, 20)),
        fetchPremarketStats(ticker, date, Number.POSITIVE_INFINITY),
        fetchSharesOutstanding(ticker, date).catch(() => null),
        fetchSplitHistory(ticker).catch(() => []),
      ]);
      // Massive candles are adjusted for splits after `date`; undo that so the $5 / 1M filters see what traded that day.
      // Same rule as adjustPriceForSplits in lib/splits.ts: the first split executed after `date` carries the cumulative factor.
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
      const pmHigh = premarket ? premarket.high / factor : null;
      const history = asOfBars.filter((bar) => bar.date < date);
      const sessions = asOfBars.filter((bar) => bar.date >= date);
      if (sessions[0]?.date !== date) return null;
      const setup = evaluateParabolicSetup(history, { referencePrice: sessions[0].open, highSoFar: pmHigh ?? sessions[0].open });
      if (!setup) return null;
      const { metrics, plan } = setup;
      const outcome = plan ? measureReplayOutcome(history.slice(-60), plan, sessions) : null;
      return {
        date, ticker, qualified: setup.qualified, grade: setup.grade, score: setup.score,
        failedFilters: setup.failedFilters.join('; '), riskFraction: rounded(plan?.riskFraction),
        open: rounded(sessions[0].open), pmHigh: rounded(pmHigh),
        priorClose: rounded(metrics.priorClose), gapPct: rounded(metrics.tradeDayGapPct),
        ext10Pct: rounded(metrics.ext10Pct), ext20Pct: rounded(metrics.ext20Pct), atrAbove50: rounded(metrics.atrAbove50),
        greenStreak: metrics.greenStreak, gapUpStreak: metrics.gapUpStreak,
        rangeExpansions: metrics.rangeExpansions, volumeExpansions: metrics.volumeExpansions,
        cleanParabolic: setup.scoreItems.find((item) => item.label === 'Clean parabolic structure')?.status ?? '',
        change3Pct: rounded(metrics.change3Pct), change5Pct: rounded(metrics.change5Pct), change10Pct: rounded(metrics.change10Pct),
        avgVolume20: rounded(metrics.avgVolume20), sharesOutstanding: rounded(sharesOutstanding), splitFactor: factor,
        entry: rounded(plan?.entry), stop: rounded(plan?.stop), riskPerShare: rounded(plan?.riskPerShare),
        target1RR: rounded(plan?.target1RR), target2RR: rounded(plan?.target2RR),
        stoppedOutDay0: outcome?.stoppedOutDay0 ?? '', dayR: rounded(outcome?.dayR),
        mfeDayR: rounded(outcome?.mfeDayR), maeDayR: rounded(outcome?.maeDayR),
        mfe10R: rounded(outcome?.mfe10R), mae10R: rounded(outcome?.mae10R), daysTo9Ema: rounded(outcome?.daysTo9Ema),
      };
    }));
    for (const [index, result] of results.entries()) {
      if (result.status === 'fulfilled') {
        if (result.value) rows.push(result.value);
      } else {
        console.warn('parabolic replay ticker failed', candidates[offset + index], result.reason);
      }
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || b.score - a.score);
  writeFileSync(out, Papa.unparse(rows));
  for (const grade of ['A', 'B', 'C', 'Pass']) {
    const outcomes = rows.filter((row) => row.grade === grade && typeof row.dayR === 'number');
    const wins = outcomes.filter((row) => Number(row.dayR) > 0).length;
    const average = outcomes.reduce((sum, row) => sum + Number(row.dayR), 0) / outcomes.length;
    console.log(`${grade}: ${outcomes.length} setups, win rate ${outcomes.length ? (100 * wins / outcomes.length).toFixed(1) + '%' : 'n/a'}, average dayR ${outcomes.length ? average.toFixed(2) : 'n/a'}`);
  }
  console.log(`Output: ${out}`);
}

void main().catch((error) => { console.error(error); process.exit(1); });

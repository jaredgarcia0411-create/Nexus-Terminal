/**
 * parabolic-replay.ts
 *
 * Replay the parabolic short scorecard over historical sessions and export CSV outcomes.
 * Reads MASSIVE_API_KEY from .env.local.
 * Usage: npx tsx scripts/parabolic-replay.ts --from 2024-11-01 --to 2026-10-15 [--out /path/file.csv]
 *
 * Short-at-the-open (dayR) is the baseline; or5/or15/vwap/belowVwap columns replay intraday triggers (before 10:30 ET)
 * with a high-of-day stop (HodR) and the card's premarket-high stop (PmR), covering at the close; a stop under
 * 0.5 ATR from the entry counts as no trade. A touched
 * stop counts as -1R; borrow fees, locates, and slippage are not modeled. Dates within about two weeks of
 * today have fewer forward sessions. Opening volume climax is not measured, so the maximum score remains 17.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Papa from 'papaparse';
import { fetchGroupedDailyAggregates, fetchMassiveAggregateBars, fetchSharesOutstanding, fetchSplitHistory, type DailyOhlcBar } from '@/lib/massive-market';
import { addCalendarDays, fetchDailyBars, fetchPremarketStats } from '@/lib/parabolic/data';
import { MIN_HISTORY_BARS, evaluateParabolicSetup, measureIntradayTriggers, measureReplayOutcome, passesReplayPrefilter } from '@/lib/parabolic/scan';
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

  const rounded = (value: number | null | undefined): number | '' => value == null ? '' : Number(value.toFixed(2));
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
      const open = nyDateTimeToEpoch(date, '09:30:00')!;
      const close = nyDateTimeToEpoch(date, '16:00:00')!;
      // From 04:00 ET so the VWAP trigger includes premarket volume.
      const premarketStart = nyDateTimeToEpoch(date, '04:00:00')!;
      const minutes = plan
        ? (await fetchMassiveAggregateBars({ ticker, multiplier: '1', timespan: 'minute', from: String(premarketStart), to: String(close) }))
          .filter((bar) => Number(bar.t) >= premarketStart && Number(bar.t) < close
            && bar.o != null && bar.h != null && bar.l != null && bar.c != null)
          .map((bar) => ({
            time: Number(bar.t),
            open: Number(bar.o) / factor,
            high: Number(bar.h) / factor,
            low: Number(bar.l) / factor,
            close: Number(bar.c) / factor,
            volume: Number(bar.v ?? 0) * factor,
          }))
        : [];
      const triggers = plan ? measureIntradayTriggers(plan, metrics.atr14, minutes, open, sessions[0].close) : null;
      // For testing other stops: the highest price before the gap filled back to the prior close, from day-0 minute bars.
      const day0Minutes = minutes.filter((bar) => bar.time >= open);
      let highSoFar = sessions[0].open;
      let highBeforeFill: number | null = null;
      for (const bar of day0Minutes) {
        highSoFar = Math.max(highSoFar, bar.high);
        if (bar.low <= metrics.priorClose) {
          highBeforeFill = highSoFar;
          break;
        }
      }
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
        atr14: rounded(metrics.atr14), day0Close: rounded(sessions[0].close), day0High: rounded(sessions[0].high),
        minuteBars: day0Minutes.length, highBeforeFill: rounded(highBeforeFill),
        or5Min: triggers?.or5.minutesAfterOpen ?? '', or5Entry: rounded(triggers?.or5.entry), or5HodStop: rounded(triggers?.or5.hodStop), or5HodR: rounded(triggers?.or5.hodR), or5PmR: rounded(triggers?.or5.pmR),
        or15Min: triggers?.or15.minutesAfterOpen ?? '', or15Entry: rounded(triggers?.or15.entry), or15HodStop: rounded(triggers?.or15.hodStop), or15HodR: rounded(triggers?.or15.hodR), or15PmR: rounded(triggers?.or15.pmR),
        vwapMin: triggers?.vwap.minutesAfterOpen ?? '', vwapEntry: rounded(triggers?.vwap.entry), vwapHodStop: rounded(triggers?.vwap.hodStop), vwapHodR: rounded(triggers?.vwap.hodR), vwapPmR: rounded(triggers?.vwap.pmR),
        belowVwapMin: triggers?.belowVwap.minutesAfterOpen ?? '', belowVwapEntry: rounded(triggers?.belowVwap.entry), belowVwapHodStop: rounded(triggers?.belowVwap.hodStop), belowVwapHodR: rounded(triggers?.belowVwap.hodR), belowVwapPmR: rounded(triggers?.belowVwap.pmR),
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
  rows.sort((a, b) => a.date.localeCompare(b.date) || b.score - a.score || Number(b.ext10Pct) - Number(a.ext10Pct));
  writeFileSync(out, Papa.unparse(rows));
  for (const grade of ['A', 'B', 'C', 'Pass']) {
    const outcomes = rows.filter((row) => row.grade === grade && typeof row.dayR === 'number');
    const wins = outcomes.filter((row) => Number(row.dayR) > 0).length;
    const average = outcomes.reduce((sum, row) => sum + Number(row.dayR), 0) / outcomes.length;
    console.log(`${grade}: ${outcomes.length} setups, win rate ${outcomes.length ? (100 * wins / outcomes.length).toFixed(1) + '%' : 'n/a'}, average dayR ${outcomes.length ? average.toFixed(2) : 'n/a'}`);
  }
  // Same set the live card posts: grade A–C, top 9 per day.
  const postedPerDay = new Map<string, number>();
  const posted = rows.filter((row) => {
    if (row.grade === 'Pass' || typeof row.dayR !== 'number') return false;
    const count = postedPerDay.get(row.date) ?? 0;
    postedPerDay.set(row.date, count + 1);
    return count < 9;
  });
  const summarize = (label: string, values: Array<number | ''>) => {
    const trades = values.filter((value): value is number => typeof value === 'number');
    const total = trades.reduce((sum, value) => sum + value, 0);
    const wins = trades.filter((value) => value > 0).length;
    console.log(`${label}: ${trades.length}/${posted.length} trades, win rate ${trades.length ? (100 * wins / trades.length).toFixed(1) + '%' : 'n/a'}, average R ${trades.length ? (total / trades.length).toFixed(2) : 'n/a'}, total R ${total.toFixed(1)}`);
  };
  console.log(`Posted setups (grade A–C, top 9/day): ${posted.length}`);
  summarize('Short at open', posted.map((row) => row.dayR));
  summarize('OR5 break, HOD stop', posted.map((row) => row.or5HodR));
  summarize('OR5 break, PM stop', posted.map((row) => row.or5PmR));
  summarize('OR15 break, HOD stop', posted.map((row) => row.or15HodR));
  summarize('OR15 break, PM stop', posted.map((row) => row.or15PmR));
  summarize('VWAP loss, HOD stop', posted.map((row) => row.vwapHodR));
  summarize('VWAP loss, PM stop', posted.map((row) => row.vwapPmR));
  summarize('Below VWAP, HOD stop', posted.map((row) => row.belowVwapHodR));
  summarize('Below VWAP, PM stop', posted.map((row) => row.belowVwapPmR));
  console.log(`Output: ${out}`);
}

void main().catch((error) => { console.error(error); process.exit(1); });

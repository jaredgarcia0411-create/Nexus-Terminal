/**
 * triple-beat-replay.ts
 *
 * Replay the Triple Beat Earnings scorecard over historical sessions and export CSV outcomes.
 * Reads MASSIVE_API_KEY, EODHD_API_KEY, BACKGROUND_LLM_* and DATABASE_URL (CIK map) from .env.local.
 * Usage: npx tsx scripts/triple-beat-replay.ts --from 2024-11-01 --to 2026-10-15 [--out /path/file.csv]
 *
 * Candidates are liquid ticker-days ($5M+ 20-day dollar volume) with an SEC earnings filing accepted between the
 * prior session's close (16:00 ET, or 13:00 ET after a half day) and 09:00 ET on the trade date, matching the live cron; gap, price and market-cap rules
 * then use minute bars and shares outstanding as of the prior session. The first run pulls SEC filing history for
 * every liquid ticker (roughly 10–20 minutes at SEC's 10 requests/second). Entry is a break of the premarket high,
 * filled at the open when it gaps above. Day 0 is walked in minute bars so the stop and 2R target resolve in order.
 * Every later day is walked in 04:00–16:00 minute bars, so a premarket print through the stop or the 2R target fills
 * at that level, except that a bar which opens below the stop fills the stop at its open. The main outcome columns also need
 * 3x+ time-of-day RVOL at the break (volume since 09:30 through the prior minute vs the same minutes over the prior 20
 * sessions, so the break minute's own volume is not counted), matching the card; the noRvol* columns are the same trade
 * without that rule.
 * LLM earnings reads are cached in
 * ~/triple-beat-llm-cache.json so reruns only call the LLM for new ticker/dates.
 * Setups whose cached read has an unknown EPS or revenue beat (8-K filers only) get EODHD consensus estimates:
 * EODHD's EPS actual vs. estimate replaces the EPS read, and a revenue consensus triggers one re-read cached under "ticker:date:consensus".
 * Setups that fail only the premarket-range filter ("Stop < 0.5 ATR") are also read and measured with the ORB columns
 * (pmRangeFiltered = true). The card doesn't post them today, so every summary line except the last leaves them out.
 * openDollarVolume2m and openRvol2m cover day 0's 09:30 and 09:31 minute bars (the 2-minute opening range).
 * Tickers missing from
 * today's SEC CIK map (delisted/renamed) are skipped: that is survivorship bias, since companies that were later
 * delisted (bankruptcies, and acquisitions) or renamed never enter the sample, so treat the totals as slightly flattering.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Papa from 'papaparse';
import { fetchEodhdEarningsEstimates } from '@/lib/eodhd';
import { fetchGroupedDailyAggregates, fetchMassiveAggregateBars, fetchSharesOutstanding, fetchSplitHistory, type DailyOhlcBar } from '@/lib/massive-market';
import { addCalendarDays, dedupeGroupedBars, fetchDailyBars } from '@/lib/parabolic/data';
import { getRecentFilings, type SecFiling } from '@/lib/sec/submissions';
import { applyConsensusEps, buildEarningsEvidence, classifyEarnings, UNKNOWN_EARNINGS_READ, type EarningsRead } from '@/lib/triple-beat/classify';
import { fetchEarningsNews, fetchExtendedHoursStats, fetchPressReleaseText, findEarningsFiling, isEarningsHeadline } from '@/lib/triple-beat/data';
import { MAX_STOP_ATR, MIN_ENTRY_RVOL, MIN_STOP_PCT, RVOL_SESSIONS, type TripleBeatMinuteBar, evaluateTripleBeatSetup, gapBucket, measureTripleBeatOutcome, passesReplayPrefilter, timeOfDayRvol } from '@/lib/triple-beat/scan';
import { epochToNySortKey, getNextTradingSession, getNyRegularCloseTime, getPreviousTradingSession, nyDateTimeToEpoch } from '@/lib/time-utils';

// Replay-only (2026-11-12): buy the first break of the opening range high instead of the premarket high. The range is
// the first `rangeMinutes` minutes from 09:30; the entry is a buy stop 1 cent above its high, filled at the open of a
// minute that gaps past it. The stop is 1 cent under the regular-session low of day before the entry minute (the entry
// minute's own low may come after the fill). No RVOL rule, no stop-width floor, and the trade is closed by the end of
// day 0. atrTargetR sells everything at fill + 2 ATR, and twoRTargetR at fill + 2x the risk (entry minus stop), or at the
// stop or the close if that comes first; closeR only exits at the stop or the close. A minute that reaches both the stop
// and the target counts as stopped, since one minute bar can't order its own high and low. Null when the range high never breaks.
interface OrbMinute { time: number; open: number; high: number; low: number }

// De-risking exits for the opening range break, walked minute by minute from the entry minute; returns the trade's R.
// targetR sells what's left at fill + that many R. breakevenAtR moves the stop to the fill once a minute's high reaches
// fill + that many R, starting with the next minute (one minute bar can't show whether its high or low came first).
// halfAtR sells half at fill + that many R. The stop is checked before any target in each minute, like the columns above.
function walkOrbExit(
  fromEntry: OrbMinute[], fill: number, stop: number, day0Close: number,
  targetR: number, breakevenAtR: number | null, halfAtR: number | null,
): number {
  const risk = fill - stop;
  const toR = (price: number) => (price - fill) / risk;
  let currentStop = stop;
  let moveStopNextMinute = false;
  let bankedR = 0;
  let size = 1;
  for (const [offset, bar] of fromEntry.entries()) {
    if (moveStopNextMinute) currentStop = Math.max(currentStop, fill);
    if (bar.low <= currentStop) {
      // A minute that opens below the stop fills at its open; the entry minute fills at the stop.
      const exit = offset === 0 ? currentStop : Math.min(currentStop, bar.open);
      return bankedR + size * toR(exit);
    }
    if (halfAtR !== null && size === 1 && bar.high >= fill + halfAtR * risk) {
      bankedR += 0.5 * halfAtR;
      size = 0.5;
    }
    if (bar.high >= fill + targetR * risk) return bankedR + size * targetR;
    if (breakevenAtR !== null && bar.high >= fill + breakevenAtR * risk) moveStopNextMinute = true;
  }
  return bankedR + size * toR(day0Close);
}

function measureOpeningRangeBreak(minutes: OrbMinute[], openMs: number, rangeMinutes: number, atr14: number, day0Close: number) {
  const rangeEnd = openMs + rangeMinutes * 60_000;
  const range = minutes.filter((bar) => bar.time < rangeEnd);
  if (range.length === 0) return null;
  const trigger = Math.max(...range.map((bar) => bar.high)) + 0.01;
  const entryIndex = minutes.findIndex((bar) => bar.time >= rangeEnd && bar.high >= trigger);
  if (entryIndex === -1) return null;
  const fill = Math.max(minutes[entryIndex].open, trigger);
  const stop = Math.min(...minutes.slice(0, entryIndex).map((bar) => bar.low)) - 0.01;
  const risk = fill - stop;
  if (risk <= 0) return null;
  const atrTarget = fill + 2 * atr14;
  const twoRTarget = fill + 2 * risk;
  const toR = (price: number) => (price - fill) / risk;
  let atrTargetR: number | null = null;
  let twoRTargetR: number | null = null;
  let closeR: number | null = null;
  for (const [offset, bar] of minutes.slice(entryIndex).entries()) {
    if (bar.low <= stop) {
      // The entry minute fills the stop at the stop, since its open came before the entry.
      const stopR = toR(offset === 0 ? stop : Math.min(stop, bar.open));
      if (atrTargetR === null) atrTargetR = stopR;
      if (twoRTargetR === null) twoRTargetR = stopR;
      closeR = stopR;
      break;
    }
    if (atrTargetR === null && bar.high >= atrTarget) atrTargetR = toR(atrTarget);
    if (twoRTargetR === null && bar.high >= twoRTarget) twoRTargetR = 2;
  }
  const fromEntry = minutes.slice(entryIndex);
  return {
    minutesAfterOpen: (minutes[entryIndex].time - openMs) / 60_000,
    fill,
    stop,
    riskAtr: risk / atr14,
    atrTargetR: atrTargetR ?? toR(day0Close),
    twoRTargetR: twoRTargetR ?? toR(day0Close),
    closeR: closeR ?? toR(day0Close),
    // Same 2R target, but the stop moves to the fill at +1R.
    breakevenR: walkOrbExit(fromEntry, fill, stop, day0Close, 2, 1, null),
    // Half sold at +1R, the stop moves to the fill, and the other half targets 2R or the close.
    halfOffR: walkOrbExit(fromEntry, fill, stop, day0Close, 2, 1, 1),
    target15R: walkOrbExit(fromEntry, fill, stop, day0Close, 1.5, null, null),
    target3R: walkOrbExit(fromEntry, fill, stop, day0Close, 3, null, null),
  };
}

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
    const bars = dedupeGroupedBars(await fetchGroupedDailyAggregates(date, false));
    for (const bar of bars) {
      const window = windows.get(bar.ticker) ?? [];
      if (date >= from && passesReplayPrefilter(window)) candidates.push({ ticker: bar.ticker, date });
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
    if (offset % 20000 === 0) console.log(`pass 2: ${offset}/${candidates.length} (${rows.length} rows)`);
    const readsBefore = newLlmReads;
    const results = await Promise.allSettled(candidates.slice(offset, offset + 10).map(async ({ ticker, date }) => {
      const priorSession = getPreviousTradingSession(date)!;
      const windowStart = nyDateTimeToEpoch(priorSession, getNyRegularCloseTime(priorSession))!;
      const windowEnd = nyDateTimeToEpoch(date, '09:00:00')!;
      const filing = findEarningsFiling(await filingsFor(ticker), windowStart, windowEnd);
      if (!filing) return null;
      const [bars, extended, splits, sharesOutstanding] = await Promise.all([
        fetchDailyBars(ticker, addCalendarDays(date, -400), addCalendarDays(date, 100)),
        fetchExtendedHoursStats(ticker, priorSession, date, windowEnd),
        fetchSplitHistory(ticker).catch(() => []),
        fetchSharesOutstanding(ticker, priorSession).catch(() => null),
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
        premarketVolume: extended.premarketVolume * factor,
      };
      const history = asOfBars.filter((bar) => bar.date < date);
      const sessions = asOfBars.filter((bar) => bar.date >= date);
      if (sessions[0]?.date !== date) return null;
      const prefilter = evaluateTripleBeatSetup(history, asOfExtended, UNKNOWN_EARNINGS_READ, sharesOutstanding);
      if (!prefilter) return null;
      // The ORB card doesn't use the premarket range, so setups that fail only that filter are measured too (not posted).
      const pmRangeFiltered = prefilter.failedFilters.length === 1 && prefilter.failedFilters[0] === 'Stop < 0.5 ATR';
      if (!prefilter.qualified && !pmRangeFiltered) return null;
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
      if (filing.form_type === '8-K' && (earnings.epsBeat === 'unknown' || earnings.revenueBeat === 'unknown')) {
        const estimates = await fetchEodhdEarningsEstimates(ticker, priorSession, date);
        const consensusKey = `${key}:consensus`;
        if (earnings.revenueBeat === 'unknown' && estimates?.revenueEstimate != null && !llmCache[consensusKey]) {
          const read = await classifyEarnings(ticker, buildEarningsEvidence(await fetchPressReleaseText(filing), news, estimates));
          newLlmReads += 1;
          if (read) llmCache[consensusKey] = read;
        }
        earnings = applyConsensusEps(llmCache[consensusKey] ?? earnings, estimates);
      }
      const setup = evaluateTripleBeatSetup(history, asOfExtended, earnings, sharesOutstanding)!;
      const { metrics, plan } = setup;
      const measured = plan != null || pmRangeFiltered;
      const open = nyDateTimeToEpoch(date, '09:30:00')!;
      const close = nyDateTimeToEpoch(date, getNyRegularCloseTime(date))!;
      // Minute bars from the first RVOL session's open through day 0's close: day 0 walks the trade, the prior sessions
      // give the average volume at each minute of the day.
      const rvolDates = history.slice(-RVOL_SESSIONS).map((bar) => bar.date);
      const rvolStart = nyDateTimeToEpoch(rvolDates[0], '09:30:00')!;
      // Every planned setup, and every setup filtered only by its premarket range, loads minute bars for the opening range break.
      const minuteBars = measured
        ? (await fetchMassiveAggregateBars({ ticker, multiplier: '1', timespan: 'minute', from: String(rvolStart), to: String(close) }))
          .filter((bar) => bar.o != null && bar.h != null && bar.l != null)
        : [];
      // Minutes after 09:30 on the bar's own date, or -1 outside 09:30–16:00.
      const minuteOfSession = (time: number, sessionDate: string) => {
        const minute = Math.floor((time - nyDateTimeToEpoch(sessionDate, '09:30:00')!) / 60_000);
        return minute >= 0 && minute < 390 ? minute : -1;
      };
      // One pass groups regular-session volume by date and minute. Volumes stay as Massive returns them
      // (split-adjusted to today) on both sides, so the ratio is unaffected.
      const volumesByDate = new Map<string, number[]>();
      for (const bar of minuteBars) {
        const sessionDate = epochToNySortKey(Number(bar.t));
        const minute = minuteOfSession(Number(bar.t), sessionDate);
        if (minute === -1) continue;
        const volumes = volumesByDate.get(sessionDate) ?? new Array<number>(390).fill(0);
        volumes[minute] += Number(bar.v ?? 0);
        volumesByDate.set(sessionDate, volumes);
      }
      const volumesFor = (sessionDate: string) => volumesByDate.get(sessionDate) ?? new Array<number>(390).fill(0);
      const rvols = minuteBars.length > 0 ? timeOfDayRvol(volumesFor(date), rvolDates.map(volumesFor)) : [];
      // Opening range volume: the 09:30 and 09:31 bars. Dollar volume uses Massive's raw price × volume (both adjusted to
      // today, so the product matches the as-of dollars); the RVOL compares shares against the same two minutes of the prior sessions.
      const openVolume = (sessionDate: string) => volumesFor(sessionDate)[0] + volumesFor(sessionDate)[1];
      const priorOpenVolume = rvolDates.reduce((sum, rvolDate) => sum + openVolume(rvolDate), 0) / rvolDates.length;
      const openDollarVolume2m = minuteBars
        .filter((bar) => Number(bar.t) >= open && Number(bar.t) < open + 2 * 60_000)
        .reduce((sum, bar) => sum + Number(bar.v ?? 0) * Number(bar.vw ?? bar.c ?? 0), 0);
      const day0Minutes = minuteBars
        .filter((bar) => Number(bar.t) >= open && Number(bar.t) < close)
        .map((bar) => ({
          time: Number(bar.t),
          open: Number(bar.o) / factor,
          high: Number(bar.h) / factor,
          low: Number(bar.l) / factor,
          rvol: rvols[minuteOfSession(Number(bar.t), date)] ?? 0,
        }));
      // Later-day minute bars from 04:00 ET, one request per held day. The Map keeps one request per date, since the
      // RVOL and no-RVOL outcomes ask for the same days.
      const laterMinutes = new Map<string, Promise<TripleBeatMinuteBar[]>>();
      const loadMinutes = (sessionDate: string) => {
        if (!laterMinutes.has(sessionDate)) {
          const premarketStart = nyDateTimeToEpoch(sessionDate, '04:00:00')!;
          const dayClose = nyDateTimeToEpoch(sessionDate, getNyRegularCloseTime(sessionDate))!;
          laterMinutes.set(sessionDate, fetchMassiveAggregateBars({ ticker, multiplier: '1', timespan: 'minute', from: String(premarketStart), to: String(dayClose) })
            .then((bars) => bars
              .filter((bar) => Number(bar.t) >= premarketStart && Number(bar.t) < dayClose && bar.o != null && bar.h != null && bar.l != null)
              .map((bar) => ({ open: Number(bar.o) / factor, high: Number(bar.h) / factor, low: Number(bar.l) / factor }))));
        }
        return laterMinutes.get(sessionDate)!;
      };
      const outcome = plan ? await measureTripleBeatOutcome(history, plan, sessions, day0Minutes, MIN_ENTRY_RVOL, loadMinutes) : null;
      const noRvol = plan ? await measureTripleBeatOutcome(history, plan, sessions, day0Minutes, 0, loadMinutes) : null;
      const firstBreak = plan ? day0Minutes.find((bar) => bar.high >= plan.entry) : undefined;
      const orb2 = measured ? measureOpeningRangeBreak(day0Minutes, open, 2, metrics.atr14, sessions[0].close) : null;
      const orb3 = measured ? measureOpeningRangeBreak(day0Minutes, open, 3, metrics.atr14, sessions[0].close) : null;
      return {
        date, ticker, gapBucket: gapBucket(metrics.gapPct), grade: setup.grade, score: setup.score,
        strictTripleBeat: setup.strictTripleBeat,
        epsBeat: earnings.epsBeat, revenueBeat: earnings.revenueBeat, guidance: earnings.guidance,
        mixedCatalyst: earnings.mixedCatalyst, note: earnings.note, filingForm: filing.form_type,
        pmRangeFiltered,
        gapPct: rounded(metrics.gapPct), maxGapPct: rounded(metrics.maxGapPct), holdPct: rounded(metrics.holdPct),
        extendedVolumeRatio: rounded(metrics.extendedVolumeRatio), premarketVolume: Math.round(asOfExtended.premarketVolume),
        openDollarVolume2m: minuteBars.length > 0 ? Math.round(openDollarVolume2m) : '', openRvol2m: minuteBars.length > 0 && priorOpenVolume > 0 ? rounded(openVolume(date) / priorOpenVolume) : '',
        baseRangePct: rounded(metrics.baseRangePct), runUpPct: rounded(metrics.runUpPct),
        clearsBaseHigh: setup.scoreItems.find((item) => item.label === 'Clears 3-month high')?.status ?? '',
        avgDollarVolume20: rounded(metrics.avgDollarVolume20),
        marketCapM: metrics.marketCap == null ? '' : Math.round(metrics.marketCap / 1e6), riskAtr: rounded(plan?.riskAtr),
        riskFraction: rounded(plan?.riskFraction), entry: rounded(plan?.entry), stop: rounded(plan?.stop), splitFactor: factor,
        triggered: outcome?.triggered ?? '', fill: rounded(outcome?.fill), stoppedOutDay0: outcome?.stoppedOutDay0 ?? '',
        dayR: rounded(outcome?.dayR), hit2R: outcome?.hit2R ?? '', runnerR: rounded(outcome?.runnerR), totalR: rounded(outcome?.totalR),
        daysHeld: rounded(outcome?.daysHeld), openAtEnd: outcome?.openAtEnd ?? '', mfe20R: rounded(outcome?.mfe20R), mae20R: rounded(outcome?.mae20R),
        rvolAtFirstBreak: rounded(firstBreak?.rvol), noRvolTriggered: noRvol?.triggered ?? '', noRvolFill: rounded(noRvol?.fill),
        noRvolDayR: rounded(noRvol?.dayR), noRvolTotalR: rounded(noRvol?.totalR),
        orb2Min: orb2?.minutesAfterOpen ?? '', orb2Fill: rounded(orb2?.fill), orb2Stop: rounded(orb2?.stop), orb2RiskAtr: rounded(orb2?.riskAtr),
        orb2AtrTargetR: rounded(orb2?.atrTargetR), orb2TwoRTargetR: rounded(orb2?.twoRTargetR), orb2CloseR: rounded(orb2?.closeR),
        orb2BreakevenR: rounded(orb2?.breakevenR), orb2HalfOffR: rounded(orb2?.halfOffR),
        orb2Target15R: rounded(orb2?.target15R), orb2Target3R: rounded(orb2?.target3R),
        orb3Min: orb3?.minutesAfterOpen ?? '', orb3Fill: rounded(orb3?.fill), orb3Stop: rounded(orb3?.stop), orb3RiskAtr: rounded(orb3?.riskAtr),
        orb3AtrTargetR: rounded(orb3?.atrTargetR), orb3TwoRTargetR: rounded(orb3?.twoRTargetR), orb3CloseR: rounded(orb3?.closeR),
        orb3BreakevenR: rounded(orb3?.breakevenR), orb3HalfOffR: rounded(orb3?.halfOffR),
        orb3Target15R: rounded(orb3?.target15R), orb3Target3R: rounded(orb3?.target3R),
      };
    }));
    for (const [index, result] of results.entries()) {
      if (result.status === 'fulfilled') {
        if (result.value) rows.push(result.value);
      } else {
        console.warn('triple beat replay ticker failed', candidates[offset + index], result.reason);
      }
    }
    if (newLlmReads > readsBefore) writeFileSync(cachePath, JSON.stringify(llmCache));
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || b.score - a.score || Number(b.gapPct) - Number(a.gapPct));
  writeFileSync(out, Papa.unparse(rows));
  // Setups filtered only by their premarket range aren't posted, so the summaries below leave them out (except the last line).
  const qualifiedRows = rows.filter((row) => !row.pmRangeFiltered);
  const summarize = (label: string, group: Array<{ dayR: number | ''; totalR: number | '' }>) => {
    const traded = group.filter((row) => typeof row.totalR === 'number');
    const wins = traded.filter((row) => Number(row.totalR) > 0).length;
    const average = (key: 'dayR' | 'totalR') => (traded.length
      ? (traded.reduce((sum, row) => sum + Number(row[key]), 0) / traded.length).toFixed(2) : 'n/a');
    const total = traded.reduce((sum, row) => sum + Number(row.totalR), 0);
    console.log(`${label}: ${group.length} setups, ${traded.length} triggered, win rate ${traded.length ? (100 * wins / traded.length).toFixed(1) + '%' : 'n/a'}, avg dayR ${average('dayR')}, avg totalR ${average('totalR')}, total R ${total.toFixed(1)}`);
  };
  for (const grade of ['A+', 'A', 'B', 'Pass']) summarize(`Grade ${grade}`, qualifiedRows.filter((row) => row.grade === grade));
  for (const bucket of ['<4', '4-7.9', '8-9.9', '10+']) summarize(`Gap ${bucket}%`, qualifiedRows.filter((row) => row.gapBucket === bucket));
  summarize('Strict triple beat', qualifiedRows.filter((row) => row.strictTripleBeat === true));
  // 2026-11-03: the coworker's thinkorswim scan needs 300k+ premarket shares. Apply the floor first, then the card's top 9 per day.
  for (const floor of [0, 100_000, 300_000]) {
    const postedPerDay = new Map<string, number>();
    const posted = qualifiedRows.filter((row) => {
      if (row.grade === 'Pass' || row.premarketVolume < floor) return false;
      const count = postedPerDay.get(row.date) ?? 0;
      postedPerDay.set(row.date, count + 1);
      return count < 9;
    });
    summarize(`Posted (top 9/day), premarket volume >= ${floor / 1000}k`, posted);
    const withoutRvol = (group: typeof posted) => group.map((row) => ({ dayR: row.noRvolDayR, totalR: row.noRvolTotalR }));
    summarize(`  without the RVOL rule`, withoutRvol(posted));
  }
  // Opening range breaks over the same posted set (top 9/day, no premarket volume floor).
  const orbPerDay = new Map<string, number>();
  const orbPosted = qualifiedRows.filter((row) => {
    if (row.grade === 'Pass') return false;
    const count = orbPerDay.get(row.date) ?? 0;
    orbPerDay.set(row.date, count + 1);
    return count < 9;
  });
  const summarizeR = (label: string, values: Array<number | ''>) => {
    const trades = values.filter((value): value is number => typeof value === 'number');
    const total = trades.reduce((sum, value) => sum + value, 0);
    const wins = trades.filter((value) => value > 0).length;
    console.log(`${label}: ${trades.length}/${values.length} trades, win rate ${trades.length ? (100 * wins / trades.length).toFixed(1) + '%' : 'n/a'}, average R ${trades.length ? (total / trades.length).toFixed(2) : 'n/a'}, total R ${total.toFixed(1)}`);
  };
  const orbVariants = [
    {
      label: '2-minute ORB', atrTargetR: 'orb2AtrTargetR', twoRTargetR: 'orb2TwoRTargetR', closeR: 'orb2CloseR',
      breakevenR: 'orb2BreakevenR', halfOffR: 'orb2HalfOffR', target15R: 'orb2Target15R', target3R: 'orb2Target3R',
    },
    {
      label: '3-minute ORB', atrTargetR: 'orb3AtrTargetR', twoRTargetR: 'orb3TwoRTargetR', closeR: 'orb3CloseR',
      breakevenR: 'orb3BreakevenR', halfOffR: 'orb3HalfOffR', target15R: 'orb3Target15R', target3R: 'orb3Target3R',
    },
  ] as const;
  for (const variant of orbVariants) {
    const groups: Array<[string, typeof orbPosted]> = [
      ['posted', orbPosted],
      ['grade A/A+', orbPosted.filter((row) => row.grade === 'A+' || row.grade === 'A')],
    ];
    for (const [groupLabel, group] of groups) {
      summarizeR(`${variant.label}, 2 ATR target or close, ${groupLabel}`, group.map((row) => row[variant.atrTargetR]));
      summarizeR(`${variant.label}, 2R target or close, ${groupLabel}`, group.map((row) => row[variant.twoRTargetR]));
      summarizeR(`${variant.label}, stop or close, ${groupLabel}`, group.map((row) => row[variant.closeR]));
      summarizeR(`${variant.label}, 2R target, breakeven at +1R, ${groupLabel}`, group.map((row) => row[variant.breakevenR]));
      summarizeR(`${variant.label}, half off at +1R then breakeven, ${groupLabel}`, group.map((row) => row[variant.halfOffR]));
      summarizeR(`${variant.label}, 1.5R target or close, ${groupLabel}`, group.map((row) => row[variant.target15R]));
      summarizeR(`${variant.label}, 3R target or close, ${groupLabel}`, group.map((row) => row[variant.target3R]));
    }
  }
  // The card's rule: every non-Pass setup (not just the top 9), 2-minute ORB held to the close, skipped under a 2% stop or over 1.35 ATR.
  const cardRule = qualifiedRows.filter((row) => row.grade !== 'Pass' && typeof row.orb2Fill === 'number' && typeof row.orb2Stop === 'number'
    && row.orb2Fill - row.orb2Stop >= (MIN_STOP_PCT / 100) * row.orb2Fill
    && typeof row.orb2RiskAtr === 'number' && row.orb2RiskAtr <= MAX_STOP_ATR);
  summarizeR('Card rule, all posted', cardRule.map((row) => row.orb2CloseR));
  for (const grade of ['A+', 'A', 'B']) {
    summarizeR(`Card rule, grade ${grade}`, cardRule.filter((row) => row.grade === grade).map((row) => row.orb2CloseR));
  }
  summarizeR('Card rule, premarket range < 0.5 ATR (not posted)', rows.filter((row) => row.pmRangeFiltered && row.grade !== 'Pass'
    && typeof row.orb2Fill === 'number' && typeof row.orb2Stop === 'number'
    && row.orb2Fill - row.orb2Stop >= (MIN_STOP_PCT / 100) * row.orb2Fill
    && typeof row.orb2RiskAtr === 'number' && row.orb2RiskAtr <= MAX_STOP_ATR).map((row) => row.orb2CloseR));
  console.log(`New LLM reads: ${newLlmReads} (cache: ${cachePath})`);
  console.log(`Output: ${out}`);
}

void main().catch((error) => { console.error(error); process.exit(1); });

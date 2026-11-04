/**
 * triple-beat-replay.ts
 *
 * Replay the Triple Beat Earnings scorecard over historical sessions and export CSV outcomes.
 * Reads MASSIVE_API_KEY, EODHD_API_KEY, BACKGROUND_LLM_* and DATABASE_URL (CIK map) from .env.local.
 * Usage: npx tsx scripts/triple-beat-replay.ts --from 2024-11-01 --to 2026-10-15 [--out /path/file.csv]
 *
 * Candidates are liquid ticker-days ($5M+ 20-day dollar volume) with an SEC earnings filing accepted between the
 * prior session's 16:00 ET and 09:00 ET on the trade date, matching the live cron; gap, price and market-cap rules
 * then use minute bars and shares outstanding as of the prior session. The first run pulls SEC filing history for
 * every liquid ticker (roughly 10–20 minutes at SEC's 10 requests/second). Entry is a break of the premarket high,
 * filled at the open when it gaps above. Day 0 is walked in minute bars so the stop and 2R target resolve in order.
 * Every later day is walked in 04:00–16:00 minute bars, so a premarket print through the stop or the 2R target fills
 * at that level. The main outcome columns also need
 * 3x+ time-of-day RVOL at the break (volume since 09:30 vs the same minutes over the prior 20 sessions), matching the
 * card; the noRvol* columns are the same trade without that rule.
 * LLM earnings reads are cached in
 * ~/triple-beat-llm-cache.json so reruns only call the LLM for new ticker/dates. Tickers missing from
 * today's SEC CIK map (delisted/renamed) are skipped.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Papa from 'papaparse';
import { fetchGroupedDailyAggregates, fetchMassiveAggregateBars, fetchSharesOutstanding, fetchSplitHistory, type DailyOhlcBar } from '@/lib/massive-market';
import { addCalendarDays, fetchDailyBars } from '@/lib/parabolic/data';
import { getRecentFilings, type SecFiling } from '@/lib/sec/submissions';
import { buildEarningsEvidence, classifyEarnings, UNKNOWN_EARNINGS_READ, type EarningsRead } from '@/lib/triple-beat/classify';
import { fetchEarningsNews, fetchExtendedHoursStats, fetchPressReleaseText, findEarningsFiling, isEarningsHeadline } from '@/lib/triple-beat/data';
import { MIN_ENTRY_RVOL, RVOL_SESSIONS, type TripleBeatMinuteBar, evaluateTripleBeatSetup, gapBucket, measureTripleBeatOutcome, passesReplayPrefilter, timeOfDayRvol } from '@/lib/triple-beat/scan';
import { epochToNySortKey, getNextTradingSession, getNyRegularCloseTime, getPreviousTradingSession, nyDateTimeToEpoch } from '@/lib/time-utils';

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
    // The grouped feed can list a ticker twice on a date (TPC did), which would count the same trade twice.
    const seenToday = new Set<string>();
    for (const bar of bars) {
      if (seenToday.has(bar.ticker)) continue;
      seenToday.add(bar.ticker);
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
      if (!evaluateTripleBeatSetup(history, asOfExtended, UNKNOWN_EARNINGS_READ, sharesOutstanding)?.qualified) return null;
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
      const setup = evaluateTripleBeatSetup(history, asOfExtended, earnings, sharesOutstanding)!;
      const { metrics, plan } = setup;
      const open = nyDateTimeToEpoch(date, '09:30:00')!;
      const close = nyDateTimeToEpoch(date, getNyRegularCloseTime(date))!;
      // Minute bars from the first RVOL session's open through day 0's close: day 0 walks the trade, the prior sessions
      // give the average volume at each minute of the day.
      const rvolDates = history.slice(-RVOL_SESSIONS).map((bar) => bar.date);
      const rvolStart = nyDateTimeToEpoch(rvolDates[0], '09:30:00')!;
      const minuteBars = plan && sessions[0].high >= plan.entry
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
      const day0Minutes = minuteBars
        .filter((bar) => Number(bar.t) >= open && Number(bar.t) < close)
        .map((bar) => ({
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
      return {
        date, ticker, gapBucket: gapBucket(metrics.gapPct), grade: setup.grade, score: setup.score,
        strictTripleBeat: setup.strictTripleBeat,
        epsBeat: earnings.epsBeat, revenueBeat: earnings.revenueBeat, guidance: earnings.guidance,
        mixedCatalyst: earnings.mixedCatalyst, note: earnings.note, filingForm: filing.form_type,
        gapPct: rounded(metrics.gapPct), maxGapPct: rounded(metrics.maxGapPct), holdPct: rounded(metrics.holdPct),
        extendedVolumeRatio: rounded(metrics.extendedVolumeRatio), premarketVolume: Math.round(asOfExtended.premarketVolume),
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
  const summarize = (label: string, group: Array<{ dayR: number | ''; totalR: number | '' }>) => {
    const traded = group.filter((row) => typeof row.totalR === 'number');
    const wins = traded.filter((row) => Number(row.totalR) > 0).length;
    const average = (key: 'dayR' | 'totalR') => (traded.length
      ? (traded.reduce((sum, row) => sum + Number(row[key]), 0) / traded.length).toFixed(2) : 'n/a');
    const total = traded.reduce((sum, row) => sum + Number(row.totalR), 0);
    console.log(`${label}: ${group.length} setups, ${traded.length} triggered, win rate ${traded.length ? (100 * wins / traded.length).toFixed(1) + '%' : 'n/a'}, avg dayR ${average('dayR')}, avg totalR ${average('totalR')}, total R ${total.toFixed(1)}`);
  };
  for (const grade of ['A+', 'A', 'B', 'Pass']) summarize(`Grade ${grade}`, rows.filter((row) => row.grade === grade));
  for (const bucket of ['<4', '4-7.9', '8-9.9', '10+']) summarize(`Gap ${bucket}%`, rows.filter((row) => row.gapBucket === bucket));
  summarize('Strict triple beat', rows.filter((row) => row.strictTripleBeat === true));
  // 2026-11-03: the coworker's thinkorswim scan needs 300k+ premarket shares. Apply the floor first, then the card's top 9 per day.
  for (const floor of [0, 100_000, 300_000]) {
    const postedPerDay = new Map<string, number>();
    const posted = rows.filter((row) => {
      if (row.grade === 'Pass' || row.premarketVolume < floor) return false;
      const count = postedPerDay.get(row.date) ?? 0;
      postedPerDay.set(row.date, count + 1);
      return count < 9;
    });
    summarize(`Posted (top 9/day), premarket volume >= ${floor / 1000}k`, posted);
    summarize(`  sized (A/A+, stop <= 1.5 ATR)`, posted.filter((row) => Number(row.riskFraction) > 0));
    const withoutRvol = (group: typeof posted) => group.map((row) => ({ dayR: row.noRvolDayR, totalR: row.noRvolTotalR }));
    summarize(`  without the RVOL rule`, withoutRvol(posted));
    summarize(`  sized, without the RVOL rule`, withoutRvol(posted.filter((row) => Number(row.riskFraction) > 0)));
  }
  console.log(`New LLM reads: ${newLlmReads} (cache: ${cachePath})`);
  console.log(`Output: ${out}`);
}

void main().catch((error) => { console.error(error); process.exit(1); });

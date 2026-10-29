import { z } from 'zod';
import { fetchSharesOutstanding } from '@/lib/massive-market';
import { addCalendarDays, fetchDailyBars } from '@/lib/parabolic/data';
import { getRecentFilings } from '@/lib/sec/submissions';
import { UNKNOWN_EARNINGS_READ, buildEarningsEvidence, classifyEarnings } from '@/lib/triple-beat/classify';
import {
  fetchEarningsFilerTickers, fetchEarningsNews, fetchExtendedHoursStats, fetchPressReleaseText, findEarningsFiling, isEarningsHeadline,
} from '@/lib/triple-beat/data';
import { evaluateTripleBeatSetup, type TripleBeatScanReport } from '@/lib/triple-beat/scan';
import { getPreviousTradingSession, isNyTradingDay, nyDateTimeToEpoch } from '@/lib/time-utils';
import { writeAndDeliverReport } from '../discord';
import type { Blueprint, StepResult } from '../types';

const jobInputSchema = z.object({ tradingDate: z.string().max(10).date() });
// Small batches: each filer makes 3 Massive calls; survivors add SEC requests (10/s) and one LLM call.
const BATCH_SIZE = 5;

type ScanStepOutput =
  | ({ skipped: false } & TripleBeatScanReport)
  | { skipped: true; tradingDate: string };

function completedResult<T>(data: T, durationMs: number, upstreamStepIds: string[] = []): StepResult<T> {
  return {
    status: 'completed',
    data,
    metrics: { durationMs, attempt: 1 },
    provenance: { sourceIds: [], upstreamStepIds, timestamp: new Date().toISOString() },
  };
}

export const orchestratorTripleBeatScanBlueprint: Blueprint = {
  id: 'orchestrator:triple-beat-scan',
  description: 'Score premarket Triple Beat earnings gap-ups and deliver ranked Discord cards.',
  steps: [
    {
      name: 'scan-triple-beat-setups',
      type: 'code',
      metadata: { canRetry: true, timeoutMs: 300000, maxRepairAttempts: 0, sideEffect: false },
      run: async ({ jobInput }) => {
        const startedAt = Date.now();
        const { tradingDate } = jobInputSchema.parse(jobInput);
        const priorSession = getPreviousTradingSession(tradingDate);
        if (!isNyTradingDay(tradingDate) || !priorSession) {
          return completedResult<ScanStepOutput>({ skipped: true, tradingDate }, Date.now() - startedAt);
        }
        const asOfMs = Date.now();
        const windowStart = nyDateTimeToEpoch(priorSession, '16:00:00') ?? asOfMs;
        // Premarket data stops at the open, so a late run is still "as of" 9:30.
        const windowEnd = Math.min(asOfMs, nyDateTimeToEpoch(tradingDate, '09:30:00') ?? asOfMs);
        const tickers = await fetchEarningsFilerTickers(windowStart, windowEnd);
        const from = addCalendarDays(tradingDate, -400);
        const setups: TripleBeatScanReport['setups'] = [];
        for (let offset = 0; offset < tickers.length; offset += BATCH_SIZE) {
          const results = await Promise.allSettled(tickers.slice(offset, offset + BATCH_SIZE).map(async (ticker) => {
            const [history, extended, sharesOutstanding] = await Promise.all([
              fetchDailyBars(ticker, from, priorSession),
              fetchExtendedHoursStats(ticker, priorSession, tradingDate, asOfMs),
              fetchSharesOutstanding(ticker, priorSession).catch(() => null),
            ]);
            if (!extended) return null;
            // Cheap technical gate first so SEC and the LLM only run on names that can qualify.
            if (!evaluateTripleBeatSetup(history, extended, UNKNOWN_EARNINGS_READ, sharesOutstanding)?.qualified) return null;
            const filings = await getRecentFilings(ticker, { limit: 20, sinceDays: 5 });
            const filing = findEarningsFiling(filings.results, windowStart, windowEnd);
            if (!filing) return null;
            const news = await fetchEarningsNews(ticker, windowStart, windowEnd);
            if (filing.form_type === '6-K' && !news.some((item) => isEarningsHeadline(item.title))) return null;
            const evidence = buildEarningsEvidence(await fetchPressReleaseText(filing), news);
            const earnings = await classifyEarnings(ticker, evidence) ?? UNKNOWN_EARNINGS_READ;
            const setup = evaluateTripleBeatSetup(history, extended, earnings, sharesOutstanding);
            if (!setup?.plan || setup.grade === 'Pass') return null;
            return { ticker, ...setup, plan: setup.plan };
          }));
          for (const result of results) {
            if (result.status === 'fulfilled') {
              if (result.value) setups.push(result.value);
            } else {
              console.warn('triple beat scan ticker failed', result.reason);
            }
          }
        }
        setups.sort((a, b) => b.score - a.score || b.metrics.gapPct - a.metrics.gapPct);
        return completedResult<ScanStepOutput>({
          skipped: false, tradingDate, asOf: new Date(windowEnd).toISOString(),
          earningsFilings: tickers.length, setups,
        }, Date.now() - startedAt);
      },
    },
    {
      name: 'deliver-triple-beat-scan',
      type: 'code',
      metadata: { canRetry: false, timeoutMs: 10000, maxRepairAttempts: 0, sideEffect: true },
      run: async ({ previousOutput, job, db }) => {
        const output = previousOutput as ScanStepOutput;
        if (output.skipped) {
          return completedResult({ tradingDate: output.tradingDate, skipped: true }, 0, ['scan-triple-beat-setups']);
        }
        const reportJson: TripleBeatScanReport = {
          tradingDate: output.tradingDate, asOf: output.asOf,
          earningsFilings: output.earningsFilings, setups: output.setups,
        };
        const n = output.setups.length;
        const a = output.setups.filter((setup) => setup.grade === 'A').length;
        const b = output.setups.filter((setup) => setup.grade === 'B').length;
        const aPlus = output.setups.filter((setup) => setup.grade === 'A+').length;
        const summary = n === 0 ? 'No Triple Beat earnings setups.'
          : `${n} setups (A+ ${aPlus} • A ${a} • B ${b})`;
        const delivery = await writeAndDeliverReport(db, {
          jobId: job.id, userId: 'system-agent-user', agentId: 'orchestrator',
          reportType: 'triple-beat-scan', title: `${output.tradingDate} triple beat earnings scan`, summary, reportJson,
        });
        return completedResult({ tradingDate: output.tradingDate, ...delivery }, 0, ['scan-triple-beat-setups']);
      },
    },
  ],
};

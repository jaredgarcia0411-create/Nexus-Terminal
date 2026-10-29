import { z } from 'zod';
import { fetchGroupedDailyAggregates, type DailyOhlcBar } from '@/lib/massive-market';
import { addCalendarDays, fetchDailyBars, fetchPremarketStats } from '@/lib/parabolic/data';
import { evaluateParabolicSetup, passesLivePrefilter, type ParabolicScanReport } from '@/lib/parabolic/scan';
import { getPreviousTradingSession, isNyTradingDay, nyDateTimeToEpoch } from '@/lib/time-utils';
import { writeAndDeliverReport } from '../discord';
import type { Blueprint, StepResult } from '../types';

const jobInputSchema = z.object({ tradingDate: z.string().max(10).date() });
const BATCH_SIZE = 20;

type ScanStepOutput =
  | ({ skipped: false } & ParabolicScanReport)
  | { skipped: true; tradingDate: string };

function completedResult<T>(data: T, durationMs: number, upstreamStepIds: string[] = []): StepResult<T> {
  return {
    status: 'completed',
    data,
    metrics: { durationMs, attempt: 1 },
    provenance: { sourceIds: [], upstreamStepIds, timestamp: new Date().toISOString() },
  };
}

export const orchestratorParabolicScanBlueprint: Blueprint = {
  id: 'orchestrator:parabolic-scan',
  description: 'Score premarket parabolic short setups and deliver a ranked Discord report.',
  steps: [
    {
      name: 'scan-parabolic-setups',
      type: 'code',
      metadata: { canRetry: true, timeoutMs: 180000, maxRepairAttempts: 0, sideEffect: false },
      run: async ({ jobInput }) => {
        const startedAt = Date.now();
        const { tradingDate } = jobInputSchema.parse(jobInput);
        if (!isNyTradingDay(tradingDate)) {
          return completedResult<ScanStepOutput>({ skipped: true, tradingDate }, Date.now() - startedAt);
        }
        const sessions: string[] = [];
        let cursor = getPreviousTradingSession(tradingDate);
        while (cursor && sessions.length < 21) {
          sessions.unshift(cursor);
          cursor = getPreviousTradingSession(cursor);
        }
        const grouped = await Promise.all(sessions.map((date) => fetchGroupedDailyAggregates(date)));
        const windows = new Map<string, DailyOhlcBar[]>();
        grouped.forEach((bars, index) => {
          for (const { ticker, open, high, low, close, volume, vwap } of bars) {
            const window = windows.get(ticker) ?? [];
            window.push({ date: sessions[index], open, high, low, close, volume, vwap });
            windows.set(ticker, window);
          }
        });
        const candidates = [...windows.entries()]
          .filter(([, bars]) => passesLivePrefilter(bars))
          .map(([ticker]) => ticker);
        const asOfMs = Date.now();
        const from = addCalendarDays(tradingDate, -120);
        const priorSession = sessions[sessions.length - 1];
        const setups: ParabolicScanReport['setups'] = [];
        for (let offset = 0; offset < candidates.length; offset += BATCH_SIZE) {
          const results = await Promise.allSettled(candidates.slice(offset, offset + BATCH_SIZE).map(async (ticker) => {
            const [history, premarket] = await Promise.all([
              fetchDailyBars(ticker, from, priorSession),
              fetchPremarketStats(ticker, tradingDate, asOfMs),
            ]);
            if (!premarket) return null;
            // The prior-session end date excludes today's in-progress daily bar.
            const setup = evaluateParabolicSetup(history, { referencePrice: premarket.last, highSoFar: premarket.high });
            if (!setup?.qualified || !setup.plan || setup.grade === 'Pass') return null;
            return { ticker, ...setup, plan: setup.plan };
          }));
          for (const result of results) {
            if (result.status === 'fulfilled') {
              if (result.value) setups.push(result.value);
            } else {
              console.warn('parabolic scan ticker failed', result.reason);
            }
          }
        }
        setups.sort((a, b) => b.score - a.score || b.metrics.ext10Pct - a.metrics.ext10Pct);
        // Premarket data stops at the open, so a late run is still "as of" 9:30.
        const premarketEndMs = nyDateTimeToEpoch(tradingDate, '09:30:00') ?? asOfMs;
        return completedResult<ScanStepOutput>({
          skipped: false, tradingDate, asOf: new Date(Math.min(asOfMs, premarketEndMs)).toISOString(),
          candidatesChecked: candidates.length, setups,
        }, Date.now() - startedAt);
      },
    },
    {
      name: 'deliver-parabolic-scan',
      type: 'code',
      metadata: { canRetry: false, timeoutMs: 10000, maxRepairAttempts: 0, sideEffect: true },
      run: async ({ previousOutput, job, db }) => {
        const output = previousOutput as ScanStepOutput;
        if (output.skipped) {
          return completedResult({ tradingDate: output.tradingDate, skipped: true }, 0, ['scan-parabolic-setups']);
        }
        const reportJson: ParabolicScanReport = {
          tradingDate: output.tradingDate, asOf: output.asOf,
          candidatesChecked: output.candidatesChecked, setups: output.setups,
        };
        const n = output.setups.length;
        const a = output.setups.filter((setup) => setup.grade === 'A').length;
        const b = output.setups.filter((setup) => setup.grade === 'B').length;
        const c = output.setups.filter((setup) => setup.grade === 'C').length;
        const summary = n === 0 ? 'No qualified parabolic short setups.'
          : `${n} qualified setups (A ${a} • B ${b} • C ${c})`;
        const delivery = await writeAndDeliverReport(db, {
          jobId: job.id, userId: 'system-agent-user', agentId: 'orchestrator',
          reportType: 'parabolic-scan', title: `${output.tradingDate} parabolic short scan`, summary, reportJson,
        });
        return completedResult({ tradingDate: output.tradingDate, ...delivery }, 0, ['scan-parabolic-setups']);
      },
    },
  ],
};

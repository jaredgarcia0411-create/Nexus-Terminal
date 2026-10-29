import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchGroupedDailyAggregates, type DailyOhlcBar } from '@/lib/massive-market';
import { fetchDailyBars, fetchPremarketStats } from '@/lib/parabolic/data';
import { orchestratorParabolicScanBlueprint } from '@/lib/agents/blueprints/orchestrator-parabolic-scan';
import { writeAndDeliverReport } from '@/lib/agents/discord';
import { getPreviousTradingSession } from '@/lib/time-utils';
import type { StepInput } from '@/lib/agents/types';
import type { ParabolicScanReport } from '@/lib/parabolic/scan';

vi.mock('@/lib/massive-market', () => ({ fetchGroupedDailyAggregates: vi.fn() }));
vi.mock('@/lib/parabolic/data', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/parabolic/data')>(), fetchDailyBars: vi.fn(), fetchPremarketStats: vi.fn(),
}));
vi.mock('@/lib/agents/discord', () => ({ writeAndDeliverReport: vi.fn() }));

function input(overrides: Partial<StepInput> = {}): StepInput {
  return { jobInput: { tradingDate: '2026-04-07' }, previousOutput: null, job: { id: 'scan-job' }, db: {}, ...overrides } as StepInput;
}

function history(): DailyOhlcBar[] {
  const dates: string[] = [];
  let cursor = '2026-04-07';
  for (let i = 0; i < 50; i += 1) {
    cursor = getPreviousTradingSession(cursor)!;
    dates.unshift(cursor);
  }
  const accelerating = [
    [10.1, 10.6, 10, 10.5, 2_000_000], [10.8, 11.6, 10.7, 11.5, 3_000_000],
    [12, 13.6, 11.9, 13.5, 5_000_000], [14, 17.2, 13.9, 17, 9_000_000],
  ];
  return dates.map((date, index) => {
    const [open, high, low, close, volume] = accelerating[index - 46] ?? [10, 10.2, 9.8, 10, 1_500_000];
    return { date, open, high, low, close, volume, vwap: null };
  });
}

describe('orchestrator parabolic scan', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-07T13:00:00Z'));
    vi.mocked(writeAndDeliverReport).mockResolvedValue({ reportId: 'scan-job:parabolic-scan', status: 'published', deliveryError: null });
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('skips a market holiday without fetching or delivering', async () => {
    const scan = await orchestratorParabolicScanBlueprint.steps[0].run(input({ jobInput: { tradingDate: '2026-04-03' } }));
    expect(scan.data).toEqual({ skipped: true, tradingDate: '2026-04-03' });
    await orchestratorParabolicScanBlueprint.steps[1].run(input({ previousOutput: scan.data }));
    expect(fetchGroupedDailyAggregates).not.toHaveBeenCalled();
    expect(writeAndDeliverReport).not.toHaveBeenCalled();
  });

  it('keeps qualified tickers when another fails, sorts the report, and excludes today from history', async () => {
    const bars = history();
    vi.mocked(fetchGroupedDailyAggregates).mockImplementation(async (date) => ['LOW', 'FAIL', 'HIGH', 'NOPM'].map((ticker) => ({
      ...bars.find((bar) => bar.date === date)!, ticker, timestamp: Date.parse(`${date}T04:00:00Z`),
    })));
    vi.mocked(fetchDailyBars).mockImplementation(async (ticker) => {
      if (ticker === 'FAIL') throw new Error('ticker unavailable');
      return bars;
    });
    vi.mocked(fetchPremarketStats).mockImplementation(async (ticker) => ticker === 'NOPM' ? null : { last: ticker === 'HIGH' ? 19 : 18, high: 19.5 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const scan = await orchestratorParabolicScanBlueprint.steps[0].run(input());
    const report = scan.data as ParabolicScanReport;
    expect(report.candidatesChecked).toBe(4);
    expect(report.setups.map((setup) => setup.ticker)).toEqual(['HIGH', 'LOW']);
    expect(fetchDailyBars).toHaveBeenCalledWith('HIGH', '2025-12-08', '2026-04-06');
    expect(fetchPremarketStats).toHaveBeenCalledWith('HIGH', '2026-04-07', Date.now());
    expect(warn).toHaveBeenCalledOnce();
    await orchestratorParabolicScanBlueprint.steps[1].run(input({ previousOutput: scan.data }));
    expect(writeAndDeliverReport).toHaveBeenCalledWith({}, expect.objectContaining({
      reportType: 'parabolic-scan', userId: 'system-agent-user', summary: '2 qualified setups (A 2 • B 0 • C 0)',
      reportJson: { tradingDate: report.tradingDate, asOf: report.asOf, candidatesChecked: 4, setups: report.setups },
    }));
  });

  it('delivers a no-setups report on an ordinary trading day', async () => {
    vi.mocked(fetchGroupedDailyAggregates).mockResolvedValue([]);
    const scan = await orchestratorParabolicScanBlueprint.steps[0].run(input());
    await orchestratorParabolicScanBlueprint.steps[1].run(input({ previousOutput: scan.data }));
    expect(writeAndDeliverReport).toHaveBeenCalledWith({}, expect.objectContaining({ summary: 'No qualified parabolic short setups.' }));
  });
});

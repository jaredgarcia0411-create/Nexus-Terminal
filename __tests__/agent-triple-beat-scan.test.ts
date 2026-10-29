import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAllTickerSnapshots, type DailyOhlcBar } from '@/lib/massive-market';
import { fetchDailyBars } from '@/lib/parabolic/data';
import { getRecentFilings, type SecFiling } from '@/lib/sec/submissions';
import { fetchEarningsNews, fetchExtendedHoursStats, fetchPressReleaseText } from '@/lib/triple-beat/data';
import { classifyEarnings, UNKNOWN_EARNINGS_READ } from '@/lib/triple-beat/classify';
import { orchestratorTripleBeatScanBlueprint } from '@/lib/agents/blueprints/orchestrator-triple-beat-scan';
import { writeAndDeliverReport } from '@/lib/agents/discord';
import { getPreviousTradingSession } from '@/lib/time-utils';
import type { StepInput } from '@/lib/agents/types';
import type { TripleBeatScanReport } from '@/lib/triple-beat/scan';

vi.mock('@/lib/massive-market', () => ({ fetchAllTickerSnapshots: vi.fn() }));
vi.mock('@/lib/sec/submissions', () => ({ getRecentFilings: vi.fn() }));
vi.mock('@/lib/parabolic/data', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/parabolic/data')>(), fetchDailyBars: vi.fn(),
}));
vi.mock('@/lib/triple-beat/data', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/triple-beat/data')>(), fetchExtendedHoursStats: vi.fn(), fetchEarningsNews: vi.fn(), fetchPressReleaseText: vi.fn(),
}));
vi.mock('@/lib/triple-beat/classify', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/triple-beat/classify')>(), classifyEarnings: vi.fn(),
}));
vi.mock('@/lib/agents/discord', () => ({ writeAndDeliverReport: vi.fn() }));

function input(overrides: Partial<StepInput> = {}): StepInput {
  return { jobInput: { tradingDate: '2026-10-29' }, previousOutput: null, job: { id: 'scan-job' }, db: {}, ...overrides } as StepInput;
}
function history(): DailyOhlcBar[] {
  const dates: string[] = [];
  let cursor = '2026-10-29';
  for (let i = 0; i < 80; i += 1) { cursor = getPreviousTradingSession(cursor)!; dates.unshift(cursor); }
  return dates.map((date) => ({ date, open: 19.9, high: 20.4, low: 19.6, close: 20, volume: 2000000, vwap: null }));
}
const filing: SecFiling = {
  accession_number: '0001171843-26-006957', cik: '0001513761', ticker_requested: 'AAA', ticker_at_ingest: 'AAA',
  form_type: '8-K', filed_at: '2026-10-29', report_date: null, acceptance_datetime: '2026-10-29T11:00:29.000Z',
  headline: '', url: '', primary_document: null, primary_doc_description: null, items: '2.02,9.01', archive_source: null,
};
function snapshot(tickers: Array<[string, number]>) {
  return { tickers: tickers.map(([ticker, todaysChangePerc]) => ({ ticker, todaysChangePerc, prevDay: { c: 20, v: 2000000 } })) };
}
describe('orchestrator Triple Beat scan', () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-29T13:00:00Z'));
    vi.mocked(writeAndDeliverReport).mockResolvedValue({ reportId: 'scan-job:triple-beat-scan', status: 'published', deliveryError: null });
    vi.mocked(fetchDailyBars).mockResolvedValue(history());
    vi.mocked(fetchExtendedHoursStats).mockResolvedValue({ last: 23, high: 23.4, low: 21.5, volume: 800000, premarketHigh: 23.4, premarketLow: 22.6 });
    vi.mocked(fetchEarningsNews).mockResolvedValue([]);
    vi.mocked(fetchPressReleaseText).mockResolvedValue('Earnings release');
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  it('skips Thanksgiving without fetching or delivering', async () => {
    const scan = await orchestratorTripleBeatScanBlueprint.steps[0].run(input({ jobInput: { tradingDate: '2026-11-26' } }));
    expect(scan.data).toEqual({ skipped: true, tradingDate: '2026-11-26' });
    await orchestratorTripleBeatScanBlueprint.steps[1].run(input({ previousOutput: scan.data }));
    expect(fetchAllTickerSnapshots).not.toHaveBeenCalled(); expect(writeAndDeliverReport).not.toHaveBeenCalled();
  });
  it('gates catalysts, isolates ticker failures, sorts grades, and delivers the full report', async () => {
    vi.mocked(fetchAllTickerSnapshots).mockResolvedValue(snapshot([['AAA', 15], ['DDD', 12], ['CCC', 12], ['BBB', 2], ['ZZZ', 20]]));
    vi.mocked(getRecentFilings).mockImplementation(async (ticker) => {
      if (ticker === 'ZZZ') throw new Error('unavailable');
      return { status: 'success', count: 1, results: [{ ...filing, items: ticker === 'CCC' ? '5.02' : '2.02,9.01' }] };
    });
    vi.mocked(classifyEarnings).mockImplementation(async (ticker) => ticker === 'DDD' ? null : { ...UNKNOWN_EARNINGS_READ, epsBeat: 'yes', revenueBeat: 'yes', guidance: 'raised' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const scan = await orchestratorTripleBeatScanBlueprint.steps[0].run(input());
    const report = scan.data as TripleBeatScanReport;
    expect(report).toMatchObject({ gappersChecked: 4, earningsFilings: 2, asOf: '2026-10-29T13:00:00.000Z' });
    expect(report.setups.map((setup) => [setup.ticker, setup.grade])).toEqual([['AAA', 'A+'], ['DDD', 'B']]);
    expect(warn).toHaveBeenCalledOnce();
    expect(getRecentFilings).toHaveBeenCalledWith('AAA', { limit: 20, sinceDays: 5 });
    expect(getRecentFilings).not.toHaveBeenCalledWith('BBB', expect.anything());
    expect(fetchDailyBars).toHaveBeenCalledWith('AAA', '2025-09-24', '2026-10-28');
    expect(fetchExtendedHoursStats).toHaveBeenCalledWith('AAA', '2026-10-28', '2026-10-29', Date.now());
    expect(classifyEarnings).toHaveBeenCalledTimes(2);
    expect(classifyEarnings).not.toHaveBeenCalledWith('CCC', expect.anything());
    await orchestratorTripleBeatScanBlueprint.steps[1].run(input({ previousOutput: scan.data }));
    expect(writeAndDeliverReport).toHaveBeenCalledWith({}, expect.objectContaining({
      reportType: 'triple-beat-scan', summary: '2 setups (A+ 1 • A 0 • B 1)',
      reportJson: { tradingDate: report.tradingDate, asOf: report.asOf, gappersChecked: 4, earningsFilings: 2, setups: report.setups },
    }));
  });
  it('requires an earnings headline for a 6-K', async () => {
    vi.mocked(fetchAllTickerSnapshots).mockResolvedValue(snapshot([['AAA', 15]]));
    vi.mocked(getRecentFilings).mockResolvedValue({ status: 'success', count: 1, results: [{ ...filing, form_type: '6-K', items: null }] });
    vi.mocked(fetchEarningsNews).mockResolvedValue([{ source: 'massive', title: 'Acquisition news', text: '' }]);
    const scan = await orchestratorTripleBeatScanBlueprint.steps[0].run(input());
    expect(scan.data).toMatchObject({ earningsFilings: 1, setups: [] }); expect(classifyEarnings).not.toHaveBeenCalled();
    vi.mocked(fetchEarningsNews).mockResolvedValue([{ source: 'massive', title: 'Quarterly earnings', text: '' }]);
    vi.mocked(classifyEarnings).mockResolvedValue(UNKNOWN_EARNINGS_READ);
    const confirmed = await orchestratorTripleBeatScanBlueprint.steps[0].run(input());
    expect((confirmed.data as TripleBeatScanReport).setups).toHaveLength(1);
  });
  it('does not fetch news or classify technically disqualified names', async () => {
    vi.mocked(fetchAllTickerSnapshots).mockResolvedValue(snapshot([['AAA', 15]]));
    vi.mocked(getRecentFilings).mockResolvedValue({ status: 'success', count: 1, results: [filing] });
    vi.mocked(fetchExtendedHoursStats).mockResolvedValue({ last: 20.5, high: 23.4, low: 20.5, volume: 800000, premarketHigh: 23.4, premarketLow: 20.5 });
    await orchestratorTripleBeatScanBlueprint.steps[0].run(input());
    expect(fetchEarningsNews).not.toHaveBeenCalled(); expect(classifyEarnings).not.toHaveBeenCalled();
  });
  it('delivers an empty report', async () => {
    vi.mocked(fetchAllTickerSnapshots).mockResolvedValue({ tickers: [] });
    const scan = await orchestratorTripleBeatScanBlueprint.steps[0].run(input());
    await orchestratorTripleBeatScanBlueprint.steps[1].run(input({ previousOutput: scan.data }));
    expect(writeAndDeliverReport).toHaveBeenCalledWith({}, expect.objectContaining({ summary: 'No Triple Beat earnings setups.' }));
  });
});

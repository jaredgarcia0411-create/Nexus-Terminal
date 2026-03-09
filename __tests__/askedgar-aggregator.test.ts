import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  fetchAgreementsMock,
  fetchDilutionDataMock,
  fetchDilutionRatingMock,
  fetchFloatOutstandingMock,
  fetchHistoricalFloatProMock,
  fetchNasdaqComplianceMock,
  fetchNewsMock,
  fetchOfferingsMock,
  fetchPumpAndDumpTrackerMock,
  fetchRegistrationsMock,
  fetchReverseSplitsMock,
  fetchScreenerByTickerMock,
} = vi.hoisted(() => ({
  fetchAgreementsMock: vi.fn(),
  fetchDilutionDataMock: vi.fn(),
  fetchDilutionRatingMock: vi.fn(),
  fetchFloatOutstandingMock: vi.fn(),
  fetchHistoricalFloatProMock: vi.fn(),
  fetchNasdaqComplianceMock: vi.fn(),
  fetchNewsMock: vi.fn(),
  fetchOfferingsMock: vi.fn(),
  fetchPumpAndDumpTrackerMock: vi.fn(),
  fetchRegistrationsMock: vi.fn(),
  fetchReverseSplitsMock: vi.fn(),
  fetchScreenerByTickerMock: vi.fn(),
}));

vi.mock('@/lib/askedgar-client', () => ({
  fetchAgreements: fetchAgreementsMock,
  fetchDilutionData: fetchDilutionDataMock,
  fetchDilutionRating: fetchDilutionRatingMock,
  fetchFloatOutstanding: fetchFloatOutstandingMock,
  fetchHistoricalFloatPro: fetchHistoricalFloatProMock,
  fetchNasdaqCompliance: fetchNasdaqComplianceMock,
  fetchNews: fetchNewsMock,
  fetchOfferings: fetchOfferingsMock,
  fetchPumpAndDumpTracker: fetchPumpAndDumpTrackerMock,
  fetchRegistrations: fetchRegistrationsMock,
  fetchReverseSplits: fetchReverseSplitsMock,
  fetchScreenerByTicker: fetchScreenerByTickerMock,
}));

import { aggregateDilutionReport } from '@/lib/askedgar-aggregator';

function ok(results: unknown[]) {
  return Promise.resolve({ status: 'success', count: results.length, results });
}

describe('askedgar-aggregator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchFloatOutstandingMock.mockImplementation(() => ok([{ float: 100, outstanding: 200, country: 'US' }]));
    fetchScreenerByTickerMock.mockImplementation(() => ok([{ price: 1.25, market_cap: 5000000, today_volume: 1000 }]));
    fetchDilutionRatingMock.mockImplementation(() => ok([{ dilution: 'High', offering_frequency: 'Medium', offering_ability: 'Low', cash_need: 'High' }]));
    fetchDilutionDataMock.mockImplementation(() => ok([{ details: 'W', warrants_amount: 100 }, { details: 'C', conversion_price: 1.2 }]));
    fetchOfferingsMock.mockImplementation(() => ok([{ headline: 'offering' }]));
    fetchRegistrationsMock.mockImplementation(() => ok([{ headline: 'registration', is_atm: true, over_baby_shelf: true }]));
    fetchNewsMock.mockImplementation(() => ok([{ title: 'headline', summary: 's', form_type: 'news', tags: ['FDA'] }, { summary: 'filing', form_type: '8-K', tags: [] }]));
    fetchNasdaqComplianceMock.mockImplementation(() => ok([{ deficiency: 'Bid Price', risk: 'High', notes: 'notice' }]));
    fetchPumpAndDumpTrackerMock.mockImplementation(() => ok([{ country_risk: 'high', float_risk: 'low', underwriter_risk: 'medium', scam_risk: 'high' }]));
    fetchAgreementsMock.mockImplementation(() => ok([{ agreement_type: 'registration_rights' }]));
    fetchHistoricalFloatProMock.mockImplementation(() => ok([{ reported_date: '2026-03-01' }, { reported_date: '2026-03-03' }]));
    fetchReverseSplitsMock.mockImplementation(() => ok([{ execution_date: '2024-01-01', split_from: 10, split_to: 1 }]));
  });

  it('assembles a full report when all endpoints succeed', async () => {
    const result = await aggregateDilutionReport('AAPL');

    expect(result.report.ticker).toBe('AAPL');
    expect(result.report.dataSources).toHaveLength(12);
    expect(result.report.dataSources.every((source) => source.hasData)).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('handles one failed endpoint with warning and empty section', async () => {
    fetchReverseSplitsMock.mockResolvedValue({ status: 'error', count: 0, results: [], error: 'down' });

    const result = await aggregateDilutionReport('AAPL');

    expect(result.report.reverseSplits).toEqual([]);
    expect(result.warnings.some((warning) => warning.includes('Reverse Splits'))).toBe(true);
    expect(result.report.dataSources.find((source) => source.endpoint === 'reverse-splits')?.hasData).toBe(false);
  });

  it('handles all endpoint failures gracefully', async () => {
    const errorResult = Promise.resolve({ status: 'error', count: 0, results: [], error: 'fail' });
    fetchFloatOutstandingMock.mockImplementation(() => errorResult);
    fetchScreenerByTickerMock.mockImplementation(() => errorResult);
    fetchDilutionRatingMock.mockImplementation(() => errorResult);
    fetchDilutionDataMock.mockImplementation(() => errorResult);
    fetchOfferingsMock.mockImplementation(() => errorResult);
    fetchRegistrationsMock.mockImplementation(() => errorResult);
    fetchNewsMock.mockImplementation(() => errorResult);
    fetchNasdaqComplianceMock.mockImplementation(() => errorResult);
    fetchPumpAndDumpTrackerMock.mockImplementation(() => errorResult);
    fetchAgreementsMock.mockImplementation(() => errorResult);
    fetchHistoricalFloatProMock.mockImplementation(() => errorResult);
    fetchReverseSplitsMock.mockImplementation(() => errorResult);

    const result = await aggregateDilutionReport('AAPL');

    expect(result.warnings).toHaveLength(12);
    expect(result.report.dataSources.every((source) => !source.hasData)).toBe(true);
  });

  it('partitions news and filing items', async () => {
    const result = await aggregateDilutionReport('AAPL');

    expect(result.report.news.find((item) => item.formType === 'news')?.isNews).toBe(true);
    expect(result.report.news.find((item) => item.formType === '8-K')?.isNews).toBe(false);
  });

  it('separates warrants and convertibles', async () => {
    const result = await aggregateDilutionReport('AAPL');

    expect(result.report.dilution.warrants).toHaveLength(1);
    expect(result.report.dilution.convertibles).toHaveLength(1);
  });

  it('extracts catalysts from tags and compliance', async () => {
    const result = await aggregateDilutionReport('AAPL');

    expect(result.report.catalysts.some((item) => item.source === 'news')).toBe(true);
    expect(result.report.catalysts.some((item) => item.source === 'compliance')).toBe(true);
  });

  it('generates section chunks for ingestion', async () => {
    const result = await aggregateDilutionReport('AAPL');

    expect(result.chunks).toHaveLength(14);
    expect(result.chunks.every((chunk) => chunk.sourceType === 'api_data')).toBe(true);
    expect(result.chunks.every((chunk) => chunk.sourceUrl.startsWith('askedgar://AAPL/'))).toBe(true);
  });
});

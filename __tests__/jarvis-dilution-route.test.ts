import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getDbMock,
  requireUserMock,
  ensureUserMock,
  aggregateDilutionReportMock,
  runOrchestrationMock,
  checkRateLimitMock,
  logJarvisRequestMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  requireUserMock: vi.fn(),
  ensureUserMock: vi.fn(),
  aggregateDilutionReportMock: vi.fn(),
  runOrchestrationMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  logJarvisRequestMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getDb: getDbMock,
}));

vi.mock('@/lib/server-db-utils', () => ({
  requireUser: requireUserMock,
  ensureUser: ensureUserMock,
}));

vi.mock('@/lib/askedgar-aggregator', () => ({
  aggregateDilutionReport: aggregateDilutionReportMock,
}));

vi.mock('@/lib/jarvis-orchestrator', () => ({
  runOrchestration: runOrchestrationMock,
}));

vi.mock('@/lib/jarvis-rate-limit', () => ({
  checkRateLimit: checkRateLimitMock,
}));

vi.mock('@/lib/jarvis-token-tracking', () => ({
  estimateInputTokens: vi.fn(() => 10),
  estimateOutputTokens: vi.fn(() => 20),
  logJarvisRequest: logJarvisRequestMock,
}));

import { POST } from '@/app/api/jarvis/route';

describe('jarvis dilution route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDbMock.mockReturnValue(null);
    requireUserMock.mockResolvedValue({ user: { id: 'user-1', email: 'u@example.com', name: null, picture: null } });
    checkRateLimitMock.mockReturnValue({ allowed: true, remaining: 99, resetAt: Date.now() + 60_000 });
    runOrchestrationMock.mockResolvedValue({
      message: 'analysis',
      structured: {
        tldr: 'tldr',
        findings: ['f1'],
        actionSteps: ['a1'],
        risks: ['r1'],
      },
      steps: [],
    });
    logJarvisRequestMock.mockResolvedValue(undefined);
    aggregateDilutionReportMock.mockResolvedValue({
      report: {
        ticker: 'AAPL',
        generatedAt: new Date().toISOString(),
        header: {
          price: 1,
          marketCap: 2,
          float: 3,
          outstanding: 4,
          country: 'US',
          industry: 'Tech',
          sector: 'Software',
          isAdr: false,
          gain1d: 1,
          gain7d: 1,
          gain30d: 1,
          volume: 1,
          avgVolume: 1,
          shortFloat: 0.1,
          shortInterest: 10,
          feeRate: 2,
          insiderPercent: 0.1,
          affiliatePercent: 0.1,
          institutionsPercent: 0.1,
        },
        dataSources: [],
        news: [],
        catalysts: [],
        dilution: { rating: 'Low', description: '', warrantExercise: 'Low', warrantExerciseDesc: '', warrants: [], convertibles: [] },
        offeringFrequency: { rating: 'Low', description: '', offerings: [] },
        offeringAbility: { rating: 'Low', description: '', registrations: [] },
        cashNeed: { rating: 'Low', description: '', estimatedCash: null, cashBurn: null, cashRemainingMonths: null, totalDebt: null },
        managementCommentary: '',
        overallOfferingRisk: { rating: 'Low', regsho: false, nasdaqCompliance: '', nasdaqComplianceDesc: '' },
        scamRisk: {
          countryRisk: 'low',
          floatRisk: 'low',
          underwriterRisk: 'low',
          scamRisk: 'low',
          scamDescription: '',
          liquidationHistory: '',
          numberOfLiquidations: 0,
          lastLiquidationDate: '',
          ipoDate: '',
          lockUpExpiration: '',
          underwriters: '',
        },
        agreements: [],
        historicalFloat: [],
        reverseSplits: [],
      },
      chunks: [
        {
          sourceUrl: 'askedgar://AAPL/header',
          sourceHost: 'askedgar.io',
          sourceTitle: 'AskEdgar header',
          sourceType: 'api_data',
          index: 0,
          startToken: 0,
          endToken: 4,
          tokenCount: 4,
          text: 'header chunk',
          hash: 'hash',
          relevance: 0.9,
          tickers: ['AAPL'],
        },
      ],
      warnings: [],
    });
  });

  it('returns 400 when ticker is missing', async () => {
    const response = await POST(new Request('http://localhost/api/jarvis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'dilution-research' }),
    }));

    const payload = await response?.json();
    expect(response?.status).toBe(400);
    expect(payload.error).toContain('Ticker is required');
  });

  it('returns 400 when ticker format is invalid', async () => {
    const response = await POST(new Request('http://localhost/api/jarvis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'dilution-research', ticker: 'aapl!' }),
    }));

    const payload = await response?.json();
    expect(response?.status).toBe(400);
    expect(payload.error).toContain('Ticker is required');
  });

  it('returns dilution report and structured payload on success', async () => {
    const response = await POST(new Request('http://localhost/api/jarvis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'dilution-research', ticker: 'AAPL' }),
    }));

    const payload = await response?.json();
    expect(response?.status).toBe(200);
    expect(aggregateDilutionReportMock).toHaveBeenCalledWith('AAPL');
    expect(payload.dilutionReport).toBeDefined();
    expect(payload.structured).toMatchObject({ tldr: 'tldr' });
  });

  it('applies rate limiting', async () => {
    checkRateLimitMock.mockReturnValueOnce({ allowed: false, remaining: 0, resetAt: Date.now() + 60_000 });

    const response = await POST(new Request('http://localhost/api/jarvis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'dilution-research', ticker: 'AAPL' }),
    }));

    expect(response?.status).toBe(429);
  });

  it('logs token tracking on success', async () => {
    await POST(new Request('http://localhost/api/jarvis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'dilution-research', ticker: 'AAPL' }),
    }));

    expect(logJarvisRequestMock).toHaveBeenCalled();
  });
});

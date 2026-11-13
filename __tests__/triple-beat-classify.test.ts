import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callLlm } from '@/lib/agents/llm-client';
import { applyConsensusEps, buildEarningsEvidence, classifyEarnings, UNKNOWN_EARNINGS_READ, verifyEarningsRead } from '@/lib/triple-beat/classify';
vi.mock('@/lib/agents/llm-client', () => ({ callLlm: vi.fn() }));
const evidence = buildEarningsEvidence(
  'Raised full year 2026 guidance, with 2026 Adjusted EBITDA now expected to be approximately $2.55 billion',
  [{ source: 'massive', title: 'Norwegian Cruise Line (NCLH) Q3 Earnings and Revenues Beat Estimates', text: 'Norwegian Cruise Line reported Q3 2026 earnings of $1.12 per share, beating consensus estimates of $0.93 and delivering a 20.43% surprise. Revenue of $2.95 billion also exceeded expectations by 2.25%.' }],
);
const read = {
  ...UNKNOWN_EARNINGS_READ, epsBeat: 'yes' as const, epsQuote: 'BEATING  consensus estimates of $0.93',
  revenueBeat: 'yes' as const, revenueQuote: 'Revenue of $2.95 billion also exceeded expectations by 2.25%.',
  guidance: 'raised' as const, guidanceQuote: 'Raised full year 2026 guidance',
};
describe('verified earnings classification', () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => vi.restoreAllMocks());
  it('appends revenue consensus without exposing the EPS estimate', () => {
    const result = buildEarningsEvidence('Release', [], {
      quarter: '2026-09-30', epsEstimate: 0.17, epsActual: 0.18, revenueEstimate: 1264367430, revenueAnalysts: 19,
    });
    expect(result.endsWith('[CONSENSUS · EODHD] Analyst consensus revenue estimate for the quarter ending 2026-09-30: $1264.4 million (19 analysts).')).toBe(true);
    expect(result).not.toContain('0.17');
  });
  it('keeps evidence unchanged without a revenue estimate', () => {
    expect(buildEarningsEvidence('Release', [], {
      quarter: '2026-09-30', epsEstimate: 0.17, epsActual: 0.18, revenueEstimate: null, revenueAnalysts: null,
    })).toBe(buildEarningsEvidence('Release', []));
  });
  it('overrides EPS on the EODHD basis and preserves other answers', () => {
    const estimates = { quarter: '2026-09-30', epsEstimate: 0.17, epsActual: 0.18, revenueEstimate: null, revenueAnalysts: null };
    expect(applyConsensusEps(read, estimates)).toEqual({ ...read, epsBeat: 'yes', epsQuote: 'EODHD: EPS 0.18 vs 0.17 consensus' });
    expect(applyConsensusEps(read, { ...estimates, epsActual: 0.17 }).epsBeat).toBe('no');
    expect(applyConsensusEps(read, { ...estimates, epsActual: null })).toBe(read);
    expect(applyConsensusEps(read, { ...estimates, epsEstimate: null })).toBe(read);
    expect(applyConsensusEps(read, null)).toBe(read);
  });
  it('keeps quotes despite whitespace and case differences', () => {
    expect(verifyEarningsRead(read, evidence)).toEqual(read);
  });
  it('downgrades invented and short quotes and unquoted guidance', () => {
    expect(verifyEarningsRead({ ...read, revenueQuote: 'revenue of $3.10 billion beat estimates' }, evidence).revenueBeat).toBe('unknown');
    const result = verifyEarningsRead({ ...read, epsQuote: '$0.93', guidance: 'none', guidanceQuote: '' }, evidence);
    expect(result.epsBeat).toBe('unknown');
    expect(result.guidance).toBe('unknown');
  });
  it('parses fenced JSON, verifies it, and uses the deterministic background lane', async () => {
    vi.mocked(callLlm).mockResolvedValue({ content: '```json\n' + JSON.stringify(read) + '\n```', inputTokens: 100, outputTokens: 0, durationMs: 1, modelUsed: 'test' });
    expect(await classifyEarnings('NCLH', evidence)).toEqual(read);
    expect(callLlm).toHaveBeenCalledWith(expect.objectContaining({ temperature: 0, maxTokens: 12_000 }), 'background', { timeoutMs: 180_000 });
  });
  it('returns uncached null for network, malformed JSON, and invalid schema failures', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(callLlm).mockRejectedValue(new Error('offline'));
    expect(await classifyEarnings('NCLH', evidence)).toBeNull();
    for (const content of ['not JSON', '{"epsBeat":"yes"}']) {
      vi.mocked(callLlm).mockResolvedValue({ content, inputTokens: 0, outputTokens: 0, durationMs: 1, modelUsed: 'test' });
      expect(await classifyEarnings('NCLH', evidence)).toBeNull();
    }
  });
  it('does not call the LLM without evidence', async () => {
    expect(await classifyEarnings('NCLH', '')).toEqual(UNKNOWN_EARNINGS_READ);
    expect(callLlm).not.toHaveBeenCalled();
  });
});

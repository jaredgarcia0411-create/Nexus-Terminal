import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getDbMock, requireUserMock, runOrchestrationMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  requireUserMock: vi.fn(),
  runOrchestrationMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getDb: getDbMock,
}));

vi.mock('@/lib/server-db-utils', () => ({
  ensureUser: vi.fn(),
  requireUser: requireUserMock,
}));

vi.mock('@/lib/jarvis-orchestrator', () => ({
  runOrchestration: runOrchestrationMock,
}));

vi.mock('@/lib/jarvis-rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true, remaining: 999, resetAt: Date.now() + 3600000 })),
}));

import { POST } from '@/app/api/jarvis/route';

const GOLDEN_PROMPTS = [
  { id: 'eval-daily-summary', mode: 'daily-summary' as const, prompt: '', description: 'Daily summary with no custom prompt' },
  { id: 'eval-trade-analysis-basic', mode: 'trade-analysis' as const, prompt: 'Review my last 5 trades and identify patterns.', description: 'Trade analysis with explicit prompt' },
  { id: 'eval-assistant-risk', mode: 'assistant' as const, prompt: 'What are the key risks for holding AAPL through earnings?', description: 'Assistant mode with risk-focused prompt' },
  { id: 'eval-assistant-no-prompt', mode: 'assistant' as const, prompt: '', description: 'Assistant mode with empty prompt' },
  { id: 'eval-macro-summary', mode: 'macro-summary' as const, prompt: 'Provide a daily macro summary.', description: 'Macro summary mode' },
  { id: 'eval-assistant-urls', mode: 'assistant' as const, prompt: 'Summarize the latest earnings data.', description: 'Assistant with source pack', sourcePackId: 'earnings' as const },
];

async function invokeJarvis(golden: (typeof GOLDEN_PROMPTS)[number]) {
  return POST(new Request('http://localhost/api/jarvis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: golden.mode,
      prompt: golden.prompt,
      sourcePackId: golden.sourcePackId,
      trades: [],
    }),
  }));
}

async function parse(response: Response | undefined) {
  if (!response) {
    throw new Error('Expected a Response from jarvis route handler');
  }
  const payload = await response.json();
  return { status: response.status, payload };
}

function assertStructuralCompliance(payload: any) {
  expect(typeof payload.message).toBe('string');
  expect(payload.message.length).toBeGreaterThan(0);
  expect(typeof payload.structured).toBe('object');
  expect(typeof payload.structured.tldr).toBe('string');
  expect(payload.structured.tldr.length).toBeGreaterThan(0);
  expect(Array.isArray(payload.structured.findings)).toBe(true);
  expect(payload.structured.findings.length).toBeGreaterThan(0);
  expect(payload.structured.findings.every((item: unknown) => typeof item === 'string')).toBe(true);
  expect(Array.isArray(payload.structured.actionSteps)).toBe(true);
  expect(payload.structured.actionSteps.length).toBeGreaterThan(0);
  expect(payload.structured.actionSteps.every((item: unknown) => typeof item === 'string')).toBe(true);
  expect(Array.isArray(payload.structured.risks)).toBe(true);
  expect(payload.structured.risks.length).toBeGreaterThan(0);
  expect(payload.structured.risks.every((item: unknown) => typeof item === 'string')).toBe(true);
}

describe('Jarvis Eval Harness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDbMock.mockReturnValue(null);
    requireUserMock.mockResolvedValue({ user: { id: 'eval-user', email: 'eval@example.com', name: null, picture: null } });
    runOrchestrationMock.mockResolvedValue({
      message: 'Macro orchestration message',
      structured: {
        tldr: 'Macro tldr',
        findings: ['Macro finding'],
        actionSteps: ['Macro action'],
        risks: ['Macro risk'],
      },
      macroSummary: {
        date: '2026-03-09',
        overallSentiment: 'mixed',
        regions: [{ region: 'us', headline: 'US headline', details: ['detail'], sentiment: 'mixed' }],
        keyRisks: ['risk'],
      },
      steps: [],
    });
    process.env.JARVIS_API_KEY = '';
  });

  afterEach(() => {
    delete process.env.JARVIS_API_KEY;
    vi.restoreAllMocks();
  });

  for (const golden of GOLDEN_PROMPTS) {
    describe(`[${golden.id}] ${golden.description}`, () => {
      it('returns 200', async () => {
        const response = await invokeJarvis(golden);
        const { status } = await parse(response);
        expect(status).toBe(200);
      });

      it('meets structural response contract', async () => {
        const response = await invokeJarvis(golden);
        const { payload } = await parse(response);
        assertStructuralCompliance(payload);
      });

      if (golden.mode === 'macro-summary') {
        it('includes macroSummary with at least one region', async () => {
          const response = await invokeJarvis(golden);
          const { payload } = await parse(response);

          expect(payload.macroSummary).toBeDefined();
          expect(typeof payload.macroSummary.date).toBe('string');
          expect(typeof payload.macroSummary.overallSentiment).toBe('string');
          expect(Array.isArray(payload.macroSummary.regions)).toBe(true);
          expect(payload.macroSummary.regions.length).toBeGreaterThan(0);
          const region = payload.macroSummary.regions[0];
          expect(typeof region.region).toBe('string');
          expect(typeof region.headline).toBe('string');
          expect(Array.isArray(region.details)).toBe(true);
          expect(typeof region.sentiment).toBe('string');
        });
      }
    });
  }
});

describe('Jarvis Eval Harness (LLM path)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDbMock.mockReturnValue(null);
    requireUserMock.mockResolvedValue({ user: { id: 'eval-user', email: 'eval@example.com', name: null, picture: null } });
    runOrchestrationMock.mockResolvedValue({
      message: 'Macro orchestration message',
      structured: {
        tldr: 'Macro tldr',
        findings: ['Macro finding'],
        actionSteps: ['Macro action'],
        risks: ['Macro risk'],
      },
      macroSummary: {
        date: '2026-03-09',
        overallSentiment: 'mixed',
        regions: [{ region: 'us', headline: 'US headline', details: ['detail'], sentiment: 'mixed' }],
        keyRisks: ['risk'],
      },
      steps: [],
    });
    process.env.JARVIS_API_KEY = 'eval-key';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input instanceof Request
            ? input.url
            : String(input);

      if (url.includes('integrate.api.nvidia.com') || url.includes('api.nvidia.com') || url.includes('deepseek')) {
        return new Response(JSON.stringify({
          choices: [{
            message: {
              content: '{"tldr":"Eval TLDR","findings":["f1"],"actionSteps":["a1"],"risks":["r1"]}',
            },
          }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      return new Response('<html><title>Eval Source</title>body</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    });
  });

  afterEach(() => {
    delete process.env.JARVIS_API_KEY;
    vi.restoreAllMocks();
  });

  for (const golden of GOLDEN_PROMPTS) {
    it(`[${golden.id}] meets structural response contract`, async () => {
      const response = await invokeJarvis(golden);
      const { status, payload } = await parse(response);
      expect(status).toBe(200);
      assertStructuralCompliance(payload);
      if (golden.mode === 'macro-summary') {
        expect(payload.macroSummary).toBeDefined();
        expect(Array.isArray(payload.macroSummary.regions)).toBe(true);
      }
    });
  }
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getDbMock, requireUserMock, ensureUserMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  requireUserMock: vi.fn(),
  ensureUserMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getDb: getDbMock,
}));

vi.mock('@/lib/server-db-utils', () => ({
  ensureUser: ensureUserMock,
  requireUser: requireUserMock,
}));

import { GET, POST } from '@/app/api/jarvis/route';

function isLlmUrl(url: string) {
  return url.includes('integrate.api.nvidia.com') || url.includes('api.nvidia.com') || url.includes('api.deepseek.com') || url.includes('deepseek.com');
}

async function parseResponse(response: Response | undefined) {
  if (!response) {
    throw new Error('Expected a Response from jarvis route handler');
  }

  const payload = await response.json();
  return { response, payload };
}

function makeTextResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html' },
  });
}

function makeJsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mockRememberedDb(urls: string[]) {
  const limitMock = vi.fn(async () => urls.map((url) => ({ url })));
  const orderByMock = vi.fn(() => ({ limit: limitMock }));
  const whereMock = vi.fn(() => ({ orderBy: orderByMock }));
  const fromMock = vi.fn(() => ({ where: whereMock }));
  const selectMock = vi.fn(() => ({ from: fromMock }));

  return {
    select: selectMock,
    _mocks: {
      selectMock,
      fromMock,
      whereMock,
      orderByMock,
      limitMock,
    },
  } as const;
}

describe('GET /api/jarvis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: 'user-1', email: 'u@example.com', name: null, picture: null } });
  });

  it('returns remembered urls from the database', async () => {
    const dbMock = mockRememberedDb([
      'https://www.marketwatch.com/tools/earnings',
      'https://www.earningswhispers.com/calendar',
    ]);
    getDbMock.mockReturnValueOnce(dbMock);

    const response = await GET();
    const { response: safeResponse, payload } = await parseResponse(response);

    expect(safeResponse.status).toBe(200);
    expect(payload).toEqual({ urls: [
      'https://www.marketwatch.com/tools/earnings',
      'https://www.earningswhispers.com/calendar',
    ] });
  });

  it('returns an empty list when db is unavailable', async () => {
    getDbMock.mockReturnValueOnce(null);

    const response = await GET();
    const { response: safeResponse, payload } = await parseResponse(response);

    expect(safeResponse.status).toBe(200);
    expect(payload).toEqual({ urls: [] });
  });
});

describe('POST /api/jarvis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: 'user-1', email: 'u@example.com', name: null, picture: null } });
    ensureUserMock.mockResolvedValue(undefined);
    getDbMock.mockReturnValue(null);
    process.env.JARVIS_API_KEY = '';
    delete process.env.OPENAI_API_KEY;
    delete process.env.JARVIS_API_BASE_URL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('continues processing when some URLs are blocked and returns warnings', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input instanceof Request ? input.url : String(input);
      if (url.includes('allow') || url.includes('blocked.example.com')) {
        return makeTextResponse('<html><title>Unexpected</title>ignore</html>');
      }

      return makeTextResponse('<html><title>SEC filing</title>Alpha</html>');
    });

    const response = await POST(new Request('http://localhost/api/jarvis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls: ['https://www.sec.gov/cgi-bin/browse-edgar', 'https://blocked.example.com'],
        prompt: 'Summarize the impact.',
        mode: 'assistant',
        trades: [],
      }),
    }));

    const { response: safeResponse, payload } = await parseResponse(response);

    expect(safeResponse.status).toBe(200);
    expect(payload.warnings).toEqual([
      'Domain "blocked.example.com" is not on the allowlist. To request this domain be added, please message support with the site and use case.',
    ]);
    expect(payload.sourceSummary).toContain('SEC filing');
    expect(payload.message).toContain('TL;DR: SEC filing (www.sec.gov)');
    expect(payload.sources).toHaveLength(1);
    expect(payload.sources?.[0]).toMatchObject({
      host: 'www.sec.gov',
      title: 'SEC filing',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects requests that include both source pack and manual urls', async () => {
    const response = await POST(new Request('http://localhost/api/jarvis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls: ['https://www.sec.gov/cgi-bin/browse-edgar'],
        sourcePackId: 'earnings',
      }),
    }));

    const { response: safeResponse, payload } = await parseResponse(response);

    expect(safeResponse.status).toBe(400);
    expect(payload.error).toBe('Provide either sourcePackId or urls, not both.');
  });

  it('resolves source pack id and uses pack prompt when prompt is omitted', async () => {
    const seenCalls: Array<{ url: string; body?: string }> = [];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input instanceof Request ? input.url : String(input);
      seenCalls.push({
        url,
        body: typeof init?.body === 'string' ? init.body : undefined,
      });

      if (isLlmUrl(url)) {
        return makeJsonResponse({ choices: [{ message: { content: 'pack response' } }] });
      }

      return makeTextResponse('<html><title>Earnings Pack</title>Market</html>');
    });

    process.env.JARVIS_API_KEY = 'api-key';

    const response = await POST(new Request('http://localhost/api/jarvis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourcePackId: 'earnings',
        prompt: '',
        mode: 'assistant',
      }),
    }));

    const { response: safeResponse, payload } = await parseResponse(response);
    const llmCall = seenCalls.find((entry) => isLlmUrl(entry.url));
    if (!llmCall?.body) throw new Error('Expected LLM call body');
    const llmPayload = JSON.parse(llmCall.body) as { messages?: Array<{ role: string; content: string }> };

    expect(safeResponse.status).toBe(200);
    expect(payload.message).toBe('pack response');
    expect(seenCalls.filter((entry) => !isLlmUrl(entry.url)).length).toBe(4);
    expect(llmPayload.messages?.[0].content).toContain('Return ONLY valid JSON');
    expect(llmPayload.messages?.[0].content).toContain('single JSON object');
    expect(llmPayload.messages?.[0].content).toContain('exactly these keys: tldr, findings, actionSteps, risks');
    expect(llmPayload.messages?.[1].content).toContain('Summarize the upcoming earnings calendar');
    expect(llmPayload.messages?.[1].content).toContain('Scraped chunks');
    expect(payload.sources?.length).toBeGreaterThan(0);
  });

  it('surfaces parsed structured output from the LLM', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input instanceof Request ? input.url : String(input);

      if (isLlmUrl(url)) {
        return makeJsonResponse({
          choices: [{
            message: {
              content: '{"tldr":"Momentum is improving","findings":["AAPL beats estimates","Volume above average"],"actionSteps":["Add scale only on pullback"],"risks":["Unexpected guidance cut"]}',
            },
          }],
        });
      }

      return makeTextResponse('<html><title>MarketWatch AAPL</title>Alpha</html>');
    });

    process.env.JARVIS_API_KEY = 'api-key';

    const response = await POST(new Request('http://localhost/api/jarvis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls: ['https://www.marketwatch.com/tools/earnings'],
        prompt: 'What do you think?',
        mode: 'assistant',
      }),
    }));

    const { response: safeResponse, payload } = await parseResponse(response);

    expect(safeResponse.status).toBe(200);
    expect(payload.structured).toMatchObject({
      tldr: 'Momentum is improving',
      findings: ['AAPL beats estimates', 'Volume above average'],
    });
    expect(payload.message).toContain('TL;DR: Momentum is improving');
    expect(payload.message).toContain('Action Steps');
    expect(payload.sources).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns contract-shaped response payload on successful requests', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input instanceof Request ? input.url : String(input);

      if (isLlmUrl(url)) {
        return makeJsonResponse({
          choices: [
            {
              message: {
                content: '{"tldr":"Momentum is improving","findings":["AAPL beats estimates","Volume above average"],"actionSteps":["Add scale only on pullback"],"risks":["Unexpected guidance cut"]}',
              },
            },
          ],
        });
      }

      return makeTextResponse('<html><title>MarketWatch AAPL</title>Alpha</html>');
    });

    process.env.JARVIS_API_KEY = 'api-key';

    const response = await POST(new Request('http://localhost/api/jarvis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls: ['https://www.marketwatch.com/tools/earnings'],
        prompt: 'What do you think? ',
        mode: 'assistant',
      }),
    }));

    const { response: safeResponse, payload } = await parseResponse(response);

    expect(safeResponse.status).toBe(200);
    expect(payload.structured).toEqual({
      tldr: 'Momentum is improving',
      findings: ['AAPL beats estimates', 'Volume above average'],
      actionSteps: ['Add scale only on pullback'],
      risks: ['Unexpected guidance cut'],
    });
    expect(payload.structured.findings.length).toBeGreaterThan(0);
    expect(payload.structured.actionSteps.length).toBeGreaterThan(0);
    expect(payload.structured.risks.length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to structured text parser when LLM returns malformed JSON', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input instanceof Request ? input.url : String(input);

      if (isLlmUrl(url)) {
        return makeJsonResponse({
          choices: [{
            message: {
              content: 'This response is not valid JSON and should be parsed via fallback.',
            },
          }],
        });
      }

      return makeTextResponse('<html><title>Fallback Malformed</title>Market</html>');
    });

    process.env.JARVIS_API_KEY = 'api-key';

    const response = await POST(new Request('http://localhost/api/jarvis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls: ['https://www.marketwatch.com/tools/earnings'],
        prompt: 'What changed?',
        mode: 'assistant',
      }),
    }));

    const { response: safeResponse, payload } = await parseResponse(response);

    expect(safeResponse.status).toBe(200);
    expect(payload.message).toBe('This response is not valid JSON and should be parsed via fallback.');
    expect(payload.structured).toMatchObject({
      tldr: 'This response is not valid JSON and should be parsed via fallback.',
      findings: ['This response is not valid JSON and should be parsed via fallback.'],
      actionSteps: ['Review the findings and map them to a concrete risk-aware action plan.'],
      risks: ['No explicit risk section was returned by the model.'],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns schema-shaped structured output in LLM fallback mode', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input instanceof Request ? input.url : String(input);

      return makeTextResponse(`<html><title>Fallback Market</title>Beta</html>`, 200);
    });

    process.env.JARVIS_API_KEY = '';

    const response = await POST(new Request('http://localhost/api/jarvis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls: ['https://www.marketwatch.com/tools/earnings'],
        prompt: 'What are the risks?',
        mode: 'assistant',
      }),
    }));

    const { response: safeResponse, payload } = await parseResponse(response);

    expect(safeResponse.status).toBe(200);
    expect(payload.structured.findings[0]).toContain('www.marketwatch.com · Fallback Market');
    expect(payload.structured.actionSteps).toEqual(expect.any(Array));
    expect(payload.structured.risks).toEqual(expect.any(Array));
    expect(payload.message).toContain('TL;DR: Fallback Market (www.marketwatch.com)');
    expect(payload.message).toContain('Action Steps');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns 400 for unknown source pack ids', async () => {
    const response = await POST(new Request('http://localhost/api/jarvis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourcePackId: 'nope' }),
    }));

    const { response: safeResponse, payload } = await parseResponse(response);

    expect(safeResponse.status).toBe(400);
    expect(payload.error).toBe('Unknown source pack: nope');
  });

  it('returns 400 for invalid JSON body', async () => {
    const response = await POST(new Request('http://localhost/api/jarvis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad-json',
    }));

    const { response: safeResponse, payload } = await parseResponse(response);

    expect(safeResponse.status).toBe(400);
    expect(payload.error).toBe('Invalid JSON body');
  });
});

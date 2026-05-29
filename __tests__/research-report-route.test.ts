import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  checkRateLimitMock,
  ensureUserMock,
  estimateCostCentsMock,
  generateSmallCapResearchReportMock,
  getDbMock,
  recordLlmAttemptMock,
  requireUserMock,
} = vi.hoisted(() => ({
  checkRateLimitMock: vi.fn(),
  ensureUserMock: vi.fn(),
  estimateCostCentsMock: vi.fn(() => 12),
  generateSmallCapResearchReportMock: vi.fn(),
  getDbMock: vi.fn(),
  recordLlmAttemptMock: vi.fn(async () => undefined),
  requireUserMock: vi.fn(),
}));

vi.mock('@/lib/server-db-utils', () => ({
  requireUser: requireUserMock,
  ensureUser: ensureUserMock,
  dbUnavailable: () => Response.json({ error: 'Database not configured' }, { status: 503 }),
}));

vi.mock('@/lib/db', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db')>('@/lib/db');
  return {
    ...actual,
    getDb: getDbMock,
  };
});

vi.mock('@/lib/agents/blueprints/small-cap-research', () => ({
  generateSmallCapResearchReport: generateSmallCapResearchReportMock,
}));

vi.mock('@/lib/agents/runtime-limits', () => ({
  recordLlmAttempt: recordLlmAttemptMock,
}));

vi.mock('@/lib/agents/model-pricing', () => ({
  estimateCostCents: estimateCostCentsMock,
}));

vi.mock('@/lib/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rate-limit')>('@/lib/rate-limit');
  return {
    ...actual,
    checkRateLimit: checkRateLimitMock,
  };
});

import { GET, POST } from '@/app/api/research-report/route';

const sampleReport = {
  ticker: 'AAPL',
  newsWhyRunning: { rating: 'green', explanation: 'Headline supported.' },
  themeMatch: { rating: 'yellow', explanation: 'Partial theme match.' },
  otherCatalysts: [{ catalyst: 'FDA calendar', rating: 'yellow' }],
  chartHistory: { rating: 'red', explanation: 'Prior gaps faded.' },
  dilution: { rating: 'red', explanation: 'Active shelf.' },
  offeringFrequency: { rating: 'red', explanation: 'Recent offerings.' },
  offeringAbility: { rating: 'red', explanation: 'Shelf capacity.' },
  cashNeed: { rating: 'yellow', explanation: 'Cash runway watch.' },
  overallOfferingRisk: { rating: 'red', explanation: 'High offering risk.' },
  jmt415Commentary: null,
  gapStatsTable: [],
  financialCommentary: { rating: 'yellow', explanation: 'Liquidity is tight.', source: 'llm' },
  confidence: 'high',
  evidenceIds: ['filing-1'],
};

const sampleLlmUsage = {
  modelUsed: 'llama-3.3-70b-versatile',
  inputTokens: 1200,
  outputTokens: 800,
  durationMs: 4500,
};

function createJsonRequest(body: string) {
  return new Request('http://localhost/api/research-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected response');
  return response;
}

function createSelectDb(rows: unknown[]) {
  const limit = vi.fn(async (count: number) => rows.slice(0, count));
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ orderBy }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { select, from, where, orderBy, limit };
}

function createMutationDb({
  insertWillConflict = false,
  selectRowsByCall = [[]],
}: {
  insertWillConflict?: boolean;
  selectRowsByCall?: unknown[][];
} = {}) {
  const insertValues = vi.fn(async () => {
    if (insertWillConflict) {
      const err = new Error('duplicate key value violates unique constraint');
      (err as Error & { code?: string }).code = '23505';
      throw err;
    }
  });
  const insert = vi.fn(() => ({ values: insertValues }));

  const updateWhere = vi.fn(async () => undefined);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));

  const deleteWhere = vi.fn(async () => undefined);
  const del = vi.fn(() => ({ where: deleteWhere }));

  let selectCall = 0;
  const limit = vi.fn(async (count: number) => {
    const rows = selectRowsByCall[Math.min(selectCall, selectRowsByCall.length - 1)] ?? [];
    selectCall += 1;
    return rows.slice(0, count);
  });
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ orderBy }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  return {
    delete: del,
    deleteWhere,
    from,
    insert,
    insertValues,
    limit,
    orderBy,
    select,
    update,
    updateSet,
    updateWhere,
    where,
  };
}

describe('/api/research-report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({
      user: {
        id: 'user-session',
        email: 'user@example.com',
        name: 'Test User',
        picture: null,
      },
    });
    ensureUserMock.mockResolvedValue({
      id: 'user-canonical',
      email: 'user@example.com',
      name: 'Test User',
      picture: null,
    });
    getDbMock.mockReturnValue(createSelectDb([]));
    checkRateLimitMock.mockResolvedValue({
      limited: false,
      limit: 20,
      remaining: 20,
      resetAt: new Date('2026-05-29T15:00:00.000Z'),
      retryAfterSeconds: 0,
    });
    generateSmallCapResearchReportMock.mockResolvedValue({
      report: sampleReport,
      llmUsage: sampleLlmUsage,
    });
    recordLlmAttemptMock.mockResolvedValue(undefined);
    estimateCostCentsMock.mockReturnValue(12);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns cached reports from GET without generating', async () => {
    const generatedAt = new Date('2026-05-07T14:30:00.000Z');
    const reportRowId = 'rpt-abc-123';
    getDbMock.mockReturnValueOnce(createSelectDb([{
      id: reportRowId,
      reportJson: sampleReport,
      generatedAt,
      modelUsed: 'small-cap-research',
    }]));

    const response = ensureResponse(await GET(new Request('http://localhost/api/research-report?ticker=aapl')));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ticker: 'AAPL',
      id: reportRowId,
      report: sampleReport,
      generatedAt: generatedAt.toISOString(),
      modelUsed: 'small-cap-research',
      cached: true,
    });
    expect(generateSmallCapResearchReportMock).not.toHaveBeenCalled();
  });

  it('returns a cache miss from GET when no fresh structured report exists', async () => {
    getDbMock.mockReturnValueOnce(createSelectDb([{ reportJson: null, generatedAt: new Date(), modelUsed: null }]));

    const response = ensureResponse(await GET(new Request('http://localhost/api/research-report?ticker=AAPL')));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ticker: 'AAPL', id: null, report: null, generatedAt: null, cached: false });
  });

  it('generates and stores a report from POST when no claim exists', async () => {
    const db = createMutationDb();
    getDbMock.mockReturnValueOnce(db);

    const response = ensureResponse(await POST(createJsonRequest(JSON.stringify({ ticker: ' aapl ' }))));
    const payload = await response.json();

    expect(response.status).toBe(200);
    // id is the claimId the route assigns via crypto.randomUUID — we don't pin its
    // value, only that it round-trips into the response so callers (e.g. the
    // "+ Add to Watchlist" button) can later resolve the exact row by id.
    expect(payload).toEqual({
      ticker: 'AAPL',
      id: expect.any(String),
      report: sampleReport,
      generatedAt: expect.any(String),
      cached: false,
    });
    expect(ensureUserMock).toHaveBeenCalledWith(db, expect.objectContaining({ id: 'user-session' }));
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db.insertValues).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-canonical',
      ticker: 'AAPL',
      status: 'in_progress',
      rawData: null,
      reportJson: null,
      modelUsed: null,
    }));
    expect(generateSmallCapResearchReportMock).toHaveBeenCalledWith('AAPL');
    expect(checkRateLimitMock).toHaveBeenCalledWith(db, 'user-canonical', 'research-report');
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: 'complete',
      reportJson: sampleReport,
      modelUsed: 'small-cap-research',
    }));
  });

  it('records LLM telemetry after a successful generation', async () => {
    const db = createMutationDb();
    getDbMock.mockReturnValueOnce(db);

    const response = ensureResponse(await POST(createJsonRequest(JSON.stringify({ ticker: 'AAPL' }))));
    await response.json();

    expect(response.status).toBe(200);
    expect(recordLlmAttemptMock).toHaveBeenCalledTimes(1);
    expect(recordLlmAttemptMock).toHaveBeenCalledWith(db, expect.objectContaining({
      userId: 'user-canonical',
      agentId: 'small-cap-trader',
      mode: 'site-research-report',
      lane: 'background',
      success: true,
      modelUsed: 'llama-3.3-70b-versatile',
      inputTokens: 1200,
      outputTokens: 800,
      totalTokens: 2000,
      estimatedCostCents: 12,
      durationMs: 4500,
    }));
    expect(estimateCostCentsMock).toHaveBeenCalledWith('llama-3.3-70b-versatile', 1200, 800);
  });

  it('returns validation details for an invalid POST ticker', async () => {
    const response = ensureResponse(await POST(createJsonRequest(JSON.stringify({ ticker: 'bad!' }))));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({
      error: 'Validation failed',
      details: {
        fieldErrors: {
          ticker: ['Valid ticker required'],
        },
      },
    });
    expect(generateSmallCapResearchReportMock).not.toHaveBeenCalled();
    expect(checkRateLimitMock).not.toHaveBeenCalled();
  });

  it('returns 429 from POST when the user has exceeded the report limit', async () => {
    const db = createMutationDb();
    getDbMock.mockReturnValueOnce(db);
    checkRateLimitMock.mockResolvedValueOnce({
      limited: true,
      limit: 20,
      remaining: 0,
      resetAt: new Date('2026-05-29T15:00:00.000Z'),
      retryAfterSeconds: 1800,
    });

    const response = ensureResponse(await POST(createJsonRequest(JSON.stringify({ ticker: 'AAPL' }))));
    const payload = await response.json();

    expect(response.status).toBe(429);
    expect(payload).toEqual({ error: 'Rate limit exceeded. Try again later.' });
    expect(response.headers.get('Retry-After')).toBe('1800');
    expect(response.headers.get('X-RateLimit-Limit')).toBe('20');
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(response.headers.get('X-RateLimit-Reset')).toBe('1780066800');
    expect(checkRateLimitMock).toHaveBeenCalledWith(db, 'user-canonical', 'research-report');
    expect(ensureUserMock).toHaveBeenCalled();
    expect(generateSmallCapResearchReportMock).not.toHaveBeenCalled();
  });

  it('polls and returns the completed report when another caller holds the claim', async () => {
    vi.useFakeTimers();
    const generatedAt = new Date('2026-05-07T14:30:00.000Z');
    const polledRowId = 'rpt-poll-456';
    const db = createMutationDb({
      insertWillConflict: true,
      selectRowsByCall: [
        [],
        [{
          id: polledRowId,
          reportJson: sampleReport,
          generatedAt,
          modelUsed: 'small-cap-research',
        }],
      ],
    });
    getDbMock.mockReturnValueOnce(db);

    const responsePromise = POST(createJsonRequest(JSON.stringify({ ticker: 'AAPL' })));
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);
    const response = ensureResponse(await responsePromise);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ticker: 'AAPL',
      id: polledRowId,
      report: sampleReport,
      generatedAt: generatedAt.toISOString(),
      modelUsed: 'small-cap-research',
      cached: true,
    });
    expect(generateSmallCapResearchReportMock).not.toHaveBeenCalled();
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it('returns 503 when polling times out waiting for another caller', async () => {
    vi.useFakeTimers();
    const db = createMutationDb({ insertWillConflict: true });
    getDbMock.mockReturnValueOnce(db);

    const responsePromise = POST(createJsonRequest(JSON.stringify({ ticker: 'AAPL' })));
    await vi.advanceTimersByTimeAsync(60_000);
    const response = ensureResponse(await responsePromise);
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({ error: 'Report generation in progress; retry shortly.' });
    expect(generateSmallCapResearchReportMock).not.toHaveBeenCalled();
    expect(db.select).toHaveBeenCalledTimes(30);
  });

  it('drops the claim when LLM generation fails', async () => {
    const db = createMutationDb();
    getDbMock.mockReturnValueOnce(db);
    generateSmallCapResearchReportMock.mockRejectedValueOnce(new Error('LLM unavailable'));

    const response = ensureResponse(await POST(createJsonRequest(JSON.stringify({ ticker: 'AAPL' }))));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: 'Internal server error' });
    expect(db.delete).toHaveBeenCalledTimes(2);
    expect(db.deleteWhere).toHaveBeenCalledTimes(2);
  });

  it('records a failed LLM telemetry entry when generation throws', async () => {
    const db = createMutationDb();
    getDbMock.mockReturnValueOnce(db);
    generateSmallCapResearchReportMock.mockRejectedValueOnce(new Error('LLM unavailable'));

    const response = ensureResponse(await POST(createJsonRequest(JSON.stringify({ ticker: 'AAPL' }))));
    await response.json();

    expect(response.status).toBe(500);
    expect(recordLlmAttemptMock).toHaveBeenCalledTimes(1);
    expect(recordLlmAttemptMock).toHaveBeenCalledWith(db, expect.objectContaining({
      userId: 'user-canonical',
      agentId: 'small-cap-trader',
      mode: 'site-research-report',
      lane: 'background',
      success: false,
      modelUsed: 'unknown',
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostCents: 0,
      durationMs: expect.any(Number),
    }));
    expect(db.delete).toHaveBeenCalledTimes(2);
    expect(db.deleteWhere).toHaveBeenCalledTimes(2);
  });
});

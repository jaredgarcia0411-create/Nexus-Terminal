import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  ensureUserMock,
  generateSmallCapResearchReportMock,
  getDbMock,
  requireUserMock,
} = vi.hoisted(() => ({
  ensureUserMock: vi.fn(),
  generateSmallCapResearchReportMock: vi.fn(),
  getDbMock: vi.fn(),
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

function createInsertDb() {
  const values = vi.fn(async () => undefined);
  const insert = vi.fn(() => ({ values }));
  return { insert, values };
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
    generateSmallCapResearchReportMock.mockResolvedValue(sampleReport);
  });

  it('returns cached reports from GET without generating', async () => {
    const generatedAt = new Date('2026-05-07T14:30:00.000Z');
    getDbMock.mockReturnValueOnce(createSelectDb([{
      reportJson: sampleReport,
      generatedAt,
      modelUsed: 'small-cap-research',
    }]));

    const response = ensureResponse(await GET(new Request('http://localhost/api/research-report?ticker=aapl')));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ticker: 'AAPL',
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
    expect(payload).toEqual({ ticker: 'AAPL', report: null, generatedAt: null, cached: false });
  });

  it('generates and stores a report from POST with the canonical user id', async () => {
    const db = createInsertDb();
    getDbMock.mockReturnValueOnce(db);

    const response = ensureResponse(await POST(createJsonRequest(JSON.stringify({ ticker: ' aapl ' }))));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ticker: 'AAPL',
      report: sampleReport,
      generatedAt: expect.any(String),
      cached: false,
    });
    expect(ensureUserMock).toHaveBeenCalledWith(db, expect.objectContaining({ id: 'user-session' }));
    expect(generateSmallCapResearchReportMock).toHaveBeenCalledWith('AAPL');
    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-canonical',
      ticker: 'AAPL',
      status: 'complete',
      rawData: null,
      reportJson: sampleReport,
      modelUsed: 'small-cap-research',
    }));
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
  });
});

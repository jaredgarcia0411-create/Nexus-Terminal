import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getAgentDbMock,
  requireUserMock,
  ensureUserMock,
  andMock,
  descMock,
  eqMock,
  neMock,
} = vi.hoisted(() => ({
  getAgentDbMock: vi.fn(),
  requireUserMock: vi.fn(),
  ensureUserMock: vi.fn(),
  andMock: vi.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
  descMock: vi.fn((field: unknown) => ({ type: 'desc', field })),
  eqMock: vi.fn((field: unknown, value: unknown) => ({ type: 'eq', field, value })),
  neMock: vi.fn((field: unknown, value: unknown) => ({ type: 'ne', field, value })),
}));

vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm');
  return {
    ...actual,
    and: andMock,
    desc: descMock,
    eq: eqMock,
    ne: neMock,
  };
});

vi.mock('@/lib/agents/db', () => ({
  getAgentDb: getAgentDbMock,
}));

vi.mock('@/lib/server-db-utils', () => ({
  dbUnavailable: () => Response.json({ error: 'Database not configured' }, { status: 503 }),
  ensureUser: ensureUserMock,
  requireUser: requireUserMock,
}));

import { GET as GET_DETAIL } from '@/app/api/agents/reports/[id]/route';
import { GET as GET_LIST } from '@/app/api/agents/reports/route';

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected response');
  return response;
}

function createReportsListDb(rows: Array<Record<string, unknown>>) {
  const limitMock = vi.fn().mockResolvedValue(rows);
  const orderByMock = vi.fn(() => ({
    limit: limitMock,
  }));
  const whereMock = vi.fn(() => ({
    orderBy: orderByMock,
  }));

  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: whereMock,
      })),
    })),
    _mocks: {
      limitMock,
      whereMock,
    },
  };
}

function createReportDetailDb(report: Record<string, unknown> | null) {
  const limitMock = vi.fn().mockResolvedValue(report ? [report] : []);

  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: limitMock,
        })),
      })),
    })),
  };
}

describe('agent reports route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: null,
        picture: null,
      },
    });
    ensureUserMock.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      name: null,
      picture: null,
    });
  });

  it('returns a report list on GET success', async () => {
    const db = createReportsListDb([
      {
        id: 'report-1',
        agentId: 'orchestrator',
        reportType: 'macro-summary',
        status: 'published',
        title: 'Macro Summary',
        summary: 'Daily macro readout',
        deliveryError: null,
        createdAt: new Date('2026-04-08T12:00:00.000Z'),
      },
    ]);
    getAgentDbMock.mockReturnValue(db);

    const response = ensureResponse(await GET_LIST(new Request('http://localhost/api/agents/reports')));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      reports: [
        {
          id: 'report-1',
          agent_id: 'orchestrator',
          report_type: 'macro-summary',
          title: 'Macro Summary',
          summary: 'Daily macro readout',
          status: 'published',
          delivery_error: null,
          created_at: '2026-04-08T12:00:00.000Z',
        },
      ],
    });
    expect(neMock).toHaveBeenCalledWith(expect.anything(), 'system-agent-user');
  });

  it('returns 400 when the report list query is invalid', async () => {
    const db = createReportsListDb([]);
    getAgentDbMock.mockReturnValue(db);

    const response = ensureResponse(await GET_LIST(new Request('http://localhost/api/agents/reports?limit=abc')));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Validation failed');
    expect(payload.details.fieldErrors.limit).toBeTruthy();
  });

  it('returns 503 when the report list database is unavailable', async () => {
    getAgentDbMock.mockReturnValueOnce(null);

    const response = ensureResponse(await GET_LIST(new Request('http://localhost/api/agents/reports')));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({ error: 'Database not configured' });
  });

  it('applies status and agent filters on GET list', async () => {
    const db = createReportsListDb([]);
    getAgentDbMock.mockReturnValue(db);

    await GET_LIST(new Request('http://localhost/api/agents/reports?status=published&agent_id=swing-trader&limit=10'));

    expect(db._mocks.limitMock).toHaveBeenCalledWith(10);
    expect(andMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'eq', value: 'user-1' }),
      expect.objectContaining({ type: 'ne', value: 'system-agent-user' }),
      expect.objectContaining({ type: 'eq', value: 'published' }),
      expect.objectContaining({ type: 'eq', value: 'swing-trader' }),
    );
  });

  it('returns report detail on GET success', async () => {
    getAgentDbMock.mockReturnValueOnce(createReportDetailDb({
      id: 'report-1',
      agentId: 'swing-trader',
      reportType: 'research',
      status: 'published',
      title: 'Swing Research',
      summary: 'Trade looks constructive',
      deliveryError: null,
      createdAt: new Date('2026-04-08T12:00:00.000Z'),
      reportJson: { ticker: 'AAPL' },
    }));

    const response = ensureResponse(await GET_DETAIL(
      new Request('http://localhost/api/agents/reports/report-1'),
      { params: Promise.resolve({ id: 'report-1' }) },
    ));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      report: {
        id: 'report-1',
        agent_id: 'swing-trader',
        report_type: 'research',
        title: 'Swing Research',
        summary: 'Trade looks constructive',
        status: 'published',
        delivery_error: null,
        created_at: '2026-04-08T12:00:00.000Z',
        report_json: { ticker: 'AAPL' },
      },
    });
    expect(eqMock).toHaveBeenCalledWith(expect.anything(), 'report-1');
    expect(eqMock).toHaveBeenCalledWith(expect.anything(), 'user-1');
  });

  it('returns 401 when detail auth fails', async () => {
    requireUserMock.mockResolvedValueOnce({
      error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const response = ensureResponse(await GET_DETAIL(
      new Request('http://localhost/api/agents/reports/report-1'),
      { params: Promise.resolve({ id: 'report-1' }) },
    ));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: 'Unauthorized' });
    expect(getAgentDbMock).not.toHaveBeenCalled();
  });

  it('returns 503 when report detail database is unavailable', async () => {
    getAgentDbMock.mockReturnValueOnce(null);

    const response = ensureResponse(await GET_DETAIL(
      new Request('http://localhost/api/agents/reports/report-1'),
      { params: Promise.resolve({ id: 'report-1' }) },
    ));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({ error: 'Database not configured' });
  });

  it('returns 404 when GET detail cannot find the report', async () => {
    getAgentDbMock.mockReturnValueOnce(createReportDetailDb(null));

    const response = ensureResponse(await GET_DETAIL(
      new Request('http://localhost/api/agents/reports/report-404'),
      { params: Promise.resolve({ id: 'report-404' }) },
    ));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({ error: 'report not found' });
  });

  it('returns 401 when auth fails', async () => {
    requireUserMock.mockResolvedValueOnce({
      error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const response = ensureResponse(await GET_LIST(new Request('http://localhost/api/agents/reports')));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: 'Unauthorized' });
    expect(getAgentDbMock).not.toHaveBeenCalled();
  });
});

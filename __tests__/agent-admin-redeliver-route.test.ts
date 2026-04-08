import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAgentAdminMock,
  getAgentDbMock,
  redeliverReportMock,
} = vi.hoisted(() => ({
  requireAgentAdminMock: vi.fn(),
  getAgentDbMock: vi.fn(),
  redeliverReportMock: vi.fn(),
}));

vi.mock('@/lib/agents/admin', () => ({
  requireAgentAdmin: requireAgentAdminMock,
}));

vi.mock('@/lib/agents/db', () => ({
  getAgentDb: getAgentDbMock,
}));

vi.mock('@/lib/agents/discord', () => ({
  redeliverReport: redeliverReportMock,
}));

vi.mock('@/lib/server-db-utils', () => ({
  dbUnavailable: () => Response.json({ error: 'Database not configured' }, { status: 503 }),
}));

import { POST } from '@/app/api/agents/admin/redeliver/route';

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected response');
  return response;
}

function createRedeliverDb(report: { id: string } | null) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue(report ? [report] : []),
        })),
      })),
    })),
  };
}

describe('agent admin redeliver route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAgentAdminMock.mockReturnValue(null);
  });

  it('returns published on successful redelivery', async () => {
    const db = createRedeliverDb({ id: 'report-1' });
    getAgentDbMock.mockReturnValueOnce(db);
    redeliverReportMock.mockResolvedValueOnce({
      status: 'published',
      deliveryError: null,
    });

    const response = ensureResponse(await POST(new Request('http://localhost/api/agents/admin/redeliver', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ report_id: 'report-1' }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      report_id: 'report-1',
      status: 'published',
    });
    expect(redeliverReportMock).toHaveBeenCalledWith(db, 'report-1');
  });

  it('returns delivery_failed when redelivery cannot publish', async () => {
    const db = createRedeliverDb({ id: 'report-1' });
    getAgentDbMock.mockReturnValueOnce(db);
    redeliverReportMock.mockResolvedValueOnce({
      status: 'delivery_failed',
      deliveryError: 'discord down',
    });

    const response = ensureResponse(await POST(new Request('http://localhost/api/agents/admin/redeliver', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ report_id: 'report-1' }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      report_id: 'report-1',
      status: 'delivery_failed',
    });
  });

  it('returns 400 when the redeliver payload is invalid', async () => {
    const response = ensureResponse(await POST(new Request('http://localhost/api/agents/admin/redeliver', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Validation failed');
    expect(payload.details.fieldErrors.report_id).toBeTruthy();
    expect(getAgentDbMock).not.toHaveBeenCalled();
  });

  it('returns 503 when the redeliver database is unavailable', async () => {
    getAgentDbMock.mockReturnValueOnce(null);

    const response = ensureResponse(await POST(new Request('http://localhost/api/agents/admin/redeliver', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ report_id: 'report-1' }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({ error: 'Database not configured' });
  });

  it('returns 401 when the admin key is missing', async () => {
    requireAgentAdminMock.mockReturnValueOnce(
      Response.json({ error: 'Unauthorized' }, { status: 401 }),
    );

    const response = ensureResponse(await POST(new Request('http://localhost/api/agents/admin/redeliver', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ report_id: 'report-1' }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: 'Unauthorized' });
    expect(getAgentDbMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the report is unknown', async () => {
    const db = createRedeliverDb(null);
    getAgentDbMock.mockReturnValueOnce(db);

    const response = ensureResponse(await POST(new Request('http://localhost/api/agents/admin/redeliver', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ report_id: 'missing-report' }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({ error: 'report not found' });
    expect(redeliverReportMock).not.toHaveBeenCalled();
  });
});

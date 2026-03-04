import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getDbMock,
  requireServiceClaimsMock,
  evaluatePriceAlertsMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  requireServiceClaimsMock: vi.fn(),
  evaluatePriceAlertsMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ getDb: getDbMock }));
vi.mock('@/lib/service-request', () => ({ requireServiceClaims: requireServiceClaimsMock }));
vi.mock('@/lib/price-alert-evaluator', () => ({ evaluatePriceAlerts: evaluatePriceAlertsMock }));
vi.mock('node:crypto', async (importActual) => {
  const actual = await importActual<typeof import('node:crypto')>();
  return {
    ...actual,
    randomUUID: () => 'run-123',
  };
});

import { POST } from '@/app/api/discord/alerts/evaluate/route';

describe('POST /api/discord/alerts/evaluate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 503 when database is unavailable', async () => {
    getDbMock.mockReturnValueOnce(null);

    const response = await POST(new Request('http://localhost/api/discord/alerts/evaluate', { method: 'POST' }));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({ error: 'Database not configured' });
  });

  it('returns auth error from service claims guard', async () => {
    getDbMock.mockReturnValueOnce({});
    const authError = Response.json({ error: 'Unauthorized' }, { status: 401 });
    requireServiceClaimsMock.mockResolvedValueOnce({ error: authError });

    const response = await POST(new Request('http://localhost/api/discord/alerts/evaluate', { method: 'POST' }));
    expect(response.status).toBe(401);
  });

  it('evaluates alerts and returns run summary', async () => {
    const db = {};
    getDbMock.mockReturnValueOnce(db);
    requireServiceClaimsMock.mockResolvedValueOnce({ claims: { discordUserId: 'x' } });
    evaluatePriceAlertsMock.mockResolvedValueOnce({
      evaluated: 20,
      triggered: 3,
      queuedNotifications: 2,
      duplicateNotifications: 1,
      notifiedUsers: 2,
    });

    const response = await POST(new Request('http://localhost/api/discord/alerts/evaluate', {
      method: 'POST',
      body: JSON.stringify({ maxAlerts: 123 }),
      headers: { 'Content-Type': 'application/json' },
    }));

    const payload = await response.json();

    expect(evaluatePriceAlertsMock).toHaveBeenCalledWith(db, { maxAlerts: 123, runId: 'run-123' });
    expect(payload).toEqual({
      runId: 'run-123',
      evaluated: 20,
      triggered: 3,
      queuedNotifications: 2,
      duplicateNotifications: 1,
      notifiedUsers: 2,
    });
  });
});

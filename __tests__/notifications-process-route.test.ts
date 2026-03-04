import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getDbMock,
  isAuthorizedCronRequestMock,
  processNotificationJobsMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  isAuthorizedCronRequestMock: vi.fn(),
  processNotificationJobsMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ getDb: getDbMock }));
vi.mock('@/lib/cron-auth', () => ({ isAuthorizedCronRequest: isAuthorizedCronRequestMock }));
vi.mock('@/lib/notification-jobs', () => ({ processNotificationJobs: processNotificationJobsMock }));
vi.mock('node:crypto', async (importActual) => {
  const actual = await importActual<typeof import('node:crypto')>();
  return {
    ...actual,
    randomUUID: () => 'run-notify-1',
  };
});

import { POST } from '@/app/api/notifications/process/route';

describe('POST /api/notifications/process', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns cron auth failure', async () => {
    isAuthorizedCronRequestMock.mockReturnValueOnce({
      ok: false,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const response = await POST(new Request('http://localhost/api/notifications/process', { method: 'POST' }));
    expect(response.status).toBe(401);
  });

  it('returns 503 when database is unavailable', async () => {
    isAuthorizedCronRequestMock.mockReturnValueOnce({ ok: true });
    getDbMock.mockReturnValueOnce(null);

    const response = await POST(new Request('http://localhost/api/notifications/process', { method: 'POST' }));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({ error: 'Database not configured' });
  });

  it('processes queued notifications and returns metrics', async () => {
    const db = {};
    isAuthorizedCronRequestMock.mockReturnValueOnce({ ok: true });
    getDbMock.mockReturnValueOnce(db);
    processNotificationJobsMock.mockResolvedValueOnce({
      considered: 2,
      claimed: 2,
      sent: 1,
      failed: 1,
      retried: 1,
      dead: 0,
      skipped: 0,
    });

    const response = await POST(new Request('http://localhost/api/notifications/process', {
      method: 'POST',
      body: JSON.stringify({ limit: 25 }),
      headers: { 'Content-Type': 'application/json' },
    }));

    const payload = await response.json();

    expect(processNotificationJobsMock).toHaveBeenCalledWith(db, { limit: 25, runId: 'run-notify-1' });
    expect(payload).toEqual({
      runId: 'run-notify-1',
      considered: 2,
      claimed: 2,
      sent: 1,
      failed: 1,
      retried: 1,
      dead: 0,
      skipped: 0,
    });
  });
});

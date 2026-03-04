import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getDbMock,
  requireServiceClaimsMock,
  formatTradeEventMessageMock,
  enqueueNotificationJobMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  requireServiceClaimsMock: vi.fn(),
  formatTradeEventMessageMock: vi.fn(),
  enqueueNotificationJobMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getDb: getDbMock,
}));

vi.mock('@/lib/service-request', () => ({
  requireServiceClaims: requireServiceClaimsMock,
}));

vi.mock('@/lib/discord-notify', () => ({
  formatTradeEventMessage: formatTradeEventMessageMock,
}));

vi.mock('@/lib/notification-jobs', () => ({
  enqueueNotificationJob: enqueueNotificationJobMock,
  notificationDedupeKey: (_type: string, parts: Array<string | number>) => parts.join(':'),
}));

import { POST } from '@/app/api/webhooks/trade-event/route';

function makeDbWithLinks(discordUserIds: string[]) {
  return {
    select: () => ({
      from: () => ({
        where: async () => discordUserIds.map((discordUserId) => ({ discordUserId })),
      }),
    }),
  };
}

describe('POST /api/webhooks/trade-event', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    formatTradeEventMessageMock.mockReturnValue('test message');
  });

  it('returns auth error from service claims guard', async () => {
    const authError = Response.json({ error: 'Unauthorized' }, { status: 401 });
    requireServiceClaimsMock.mockResolvedValueOnce({ error: authError });
    getDbMock.mockReturnValue(makeDbWithLinks([]));

    const request = new Request('http://localhost/api/webhooks/trade-event', {
      method: 'POST',
      body: JSON.stringify({ event: 'trade_imported', userId: 'user-1' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request as any);
    expect(response.status).toBe(401);
  });

  it('returns no_link when no linked discord users are found', async () => {
    requireServiceClaimsMock.mockResolvedValueOnce({ claims: { sub: 'ok' } });
    getDbMock.mockReturnValue(makeDbWithLinks([]));

    const request = new Request('http://localhost/api/webhooks/trade-event', {
      method: 'POST',
      body: JSON.stringify({ event: 'trade_imported', userId: 'user-1' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request as any);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      received: true,
      event: 'trade_imported',
      forwarded: false,
      reason: 'no_link',
    });
    expect(enqueueNotificationJobMock).not.toHaveBeenCalled();
  });

  it('enqueues notifications and reports queued + duplicate counts', async () => {
    requireServiceClaimsMock.mockResolvedValueOnce({ claims: { sub: 'ok' } });
    // Duplicate discord user id should be de-duplicated before enqueue attempts.
    getDbMock.mockReturnValue(makeDbWithLinks(['discord-1', 'discord-2', 'discord-1']));

    enqueueNotificationJobMock
      .mockResolvedValueOnce({ enqueued: true })
      .mockResolvedValueOnce({ enqueued: false, reason: 'duplicate' });

    const request = new Request('http://localhost/api/webhooks/trade-event', {
      method: 'POST',
      body: JSON.stringify({ event: 'trade_imported', userId: 'user-1', data: { symbol: 'AAPL' } }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request as any);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      received: true,
      event: 'trade_imported',
      forwarded: true,
      attempted: 2,
      queued: 1,
      duplicates: 1,
    });

    expect(formatTradeEventMessageMock).toHaveBeenCalledWith('trade_imported', { symbol: 'AAPL' });
    expect(enqueueNotificationJobMock).toHaveBeenCalledTimes(2);
  });
});

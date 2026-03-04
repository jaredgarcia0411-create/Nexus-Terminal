import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sendDiscordDmsMock } = vi.hoisted(() => ({
  sendDiscordDmsMock: vi.fn(),
}));

vi.mock('@/lib/discord-notify', () => ({
  sendDiscordDms: sendDiscordDmsMock,
}));

import { processNotificationJobs } from '@/lib/notification-jobs';

type Candidate = {
  id: number;
  type: 'trade_event' | 'price_alert';
  discordUserId: string;
  content: string;
  status: 'pending' | 'failed';
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date;
};

function makeProcessDb(candidates: Candidate[], claimsQueue: Array<{
  id: number;
  discordUserId: string;
  content: string;
  attempts: number;
  maxAttempts: number;
} | undefined>) {
  const appliedUpdates: Array<Record<string, unknown>> = [];

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => candidates,
          }),
        }),
      }),
    }),
    update: () => ({
      set: (setPayload: Record<string, unknown>) => ({
        where: () => {
          if (setPayload.status === 'processing') {
            const claimed = claimsQueue.shift();
            return {
              returning: async () => (claimed ? [claimed] : []),
            };
          }
          appliedUpdates.push(setPayload);
          return Promise.resolve(undefined);
        },
      }),
    }),
  };

  return { db: db as any, appliedUpdates };
}

const ORIGINAL_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  process.env.DISCORD_BOT_TOKEN = ORIGINAL_BOT_TOKEN;
});

describe('processNotificationJobs', () => {
  it('marks jobs as sent when Discord delivery succeeds', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    sendDiscordDmsMock.mockResolvedValueOnce({ delivered: 1, attempted: 1 });

    const candidate: Candidate = {
      id: 1,
      type: 'trade_event',
      discordUserId: 'discord-1',
      content: 'hello',
      status: 'pending',
      attempts: 0,
      maxAttempts: 5,
      nextAttemptAt: new Date(),
    };

    const { db, appliedUpdates } = makeProcessDb([candidate], [{
      id: 1,
      discordUserId: 'discord-1',
      content: 'hello',
      attempts: 0,
      maxAttempts: 5,
    }]);

    const metrics = await processNotificationJobs(db, { limit: 10, runId: 'run-1' });

    expect(metrics).toEqual({
      considered: 1,
      claimed: 1,
      sent: 1,
      failed: 0,
      retried: 0,
      dead: 0,
      skipped: 0,
    });

    expect(appliedUpdates.some((update) => update.status === 'sent')).toBe(true);
  });

  it('retries jobs when Discord delivery returns zero recipients', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    sendDiscordDmsMock.mockResolvedValueOnce({ delivered: 0, attempted: 1 });

    const candidate: Candidate = {
      id: 2,
      type: 'price_alert',
      discordUserId: 'discord-2',
      content: 'alert',
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      nextAttemptAt: new Date(),
    };

    const { db, appliedUpdates } = makeProcessDb([candidate], [{
      id: 2,
      discordUserId: 'discord-2',
      content: 'alert',
      attempts: 0,
      maxAttempts: 3,
    }]);

    const metrics = await processNotificationJobs(db, { limit: 10, runId: 'run-2' });

    expect(metrics).toEqual({
      considered: 1,
      claimed: 1,
      sent: 0,
      failed: 1,
      retried: 1,
      dead: 0,
      skipped: 0,
    });

    expect(appliedUpdates.some((update) => update.status === 'failed')).toBe(true);
  });

  it('marks as dead without claiming when candidate already hit max attempts', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';

    const candidate: Candidate = {
      id: 3,
      type: 'trade_event',
      discordUserId: 'discord-3',
      content: 'dead',
      status: 'failed',
      attempts: 5,
      maxAttempts: 5,
      nextAttemptAt: new Date(),
    };

    const { db } = makeProcessDb([candidate], []);

    const metrics = await processNotificationJobs(db, { limit: 10, runId: 'run-3' });

    expect(metrics).toEqual({
      considered: 1,
      claimed: 0,
      sent: 0,
      failed: 0,
      retried: 0,
      dead: 1,
      skipped: 0,
    });
    expect(sendDiscordDmsMock).not.toHaveBeenCalled();
  });

  it('fails fast and marks dead when bot token is not configured', async () => {
    process.env.DISCORD_BOT_TOKEN = '';

    const candidate: Candidate = {
      id: 4,
      type: 'trade_event',
      discordUserId: 'discord-4',
      content: 'needs token',
      status: 'pending',
      attempts: 0,
      maxAttempts: 2,
      nextAttemptAt: new Date(),
    };

    const { db, appliedUpdates } = makeProcessDb([candidate], [{
      id: 4,
      discordUserId: 'discord-4',
      content: 'needs token',
      attempts: 0,
      maxAttempts: 2,
    }]);

    const metrics = await processNotificationJobs(db, { limit: 10, runId: 'run-4' });

    expect(metrics).toEqual({
      considered: 1,
      claimed: 1,
      sent: 0,
      failed: 1,
      retried: 0,
      dead: 1,
      skipped: 0,
    });

    const failedUpdate = appliedUpdates.find((update) => update.status === 'failed');
    expect(failedUpdate?.attempts).toBe(2);
  });
});

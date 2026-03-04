import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import { notificationJobs } from '@/lib/db/schema';
import type { Db } from '@/lib/db';
import { sendDiscordDms } from '@/lib/discord-notify';

export type NotificationJobType = 'trade_event' | 'price_alert';

type EnqueueNotificationJobInput = {
  type: NotificationJobType;
  discordUserId: string;
  content: string;
  dedupeKey?: string;
  maxAttempts?: number;
};

export type EnqueueNotificationJobResult = {
  enqueued: boolean;
  jobId?: number;
  reason?: 'duplicate' | 'invalid_input';
};

export type NotificationDispatchMetrics = {
  considered: number;
  claimed: number;
  sent: number;
  failed: number;
  retried: number;
  dead: number;
  skipped: number;
};

const DEFAULT_MAX_ATTEMPTS = 5;

export function notificationDedupeKey(type: NotificationJobType, parts: Array<string | number | undefined | null>) {
  const cleaned = parts
    .map((part) => (part == null ? '' : String(part).trim()))
    .filter(Boolean)
    .join(':');
  return cleaned ? `${type}:${cleaned}` : undefined;
}

export async function enqueueNotificationJob(
  db: Db,
  input: EnqueueNotificationJobInput,
): Promise<EnqueueNotificationJobResult> {
  const discordUserId = input.discordUserId.trim();
  const content = input.content.trim();
  if (!discordUserId || !content) {
    return { enqueued: false, reason: 'invalid_input' };
  }

  const values = {
    type: input.type,
    discordUserId,
    content,
    dedupeKey: input.dedupeKey,
    status: 'pending' as const,
    attempts: 0,
    maxAttempts: Math.max(1, input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS),
    nextAttemptAt: new Date(),
    lastError: null,
    sentAt: null,
  };

  if (input.dedupeKey) {
    const inserted = await db.insert(notificationJobs)
      .values(values)
      .onConflictDoNothing({ target: notificationJobs.dedupeKey })
      .returning({ id: notificationJobs.id });

    if (inserted.length === 0) {
      return { enqueued: false, reason: 'duplicate' };
    }

    return { enqueued: true, jobId: inserted[0].id };
  }

  const inserted = await db.insert(notificationJobs)
    .values(values)
    .returning({ id: notificationJobs.id });

  return inserted[0]
    ? { enqueued: true, jobId: inserted[0].id }
    : { enqueued: false, reason: 'duplicate' };
}

function retryDelayMs(attemptNumber: number) {
  const boundedAttempt = Math.max(1, Math.min(attemptNumber, 8));
  return Math.min(10 * 60_000, 1000 * (2 ** boundedAttempt));
}

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  return 'Unknown notification error';
}

export async function processNotificationJobs(
  db: Db,
  options?: { limit?: number; runId?: string },
): Promise<NotificationDispatchMetrics> {
  const now = new Date();
  const limit = Math.max(1, Math.min(options?.limit ?? 50, 200));

  const candidates = await db.select({
    id: notificationJobs.id,
    type: notificationJobs.type,
    discordUserId: notificationJobs.discordUserId,
    content: notificationJobs.content,
    status: notificationJobs.status,
    attempts: notificationJobs.attempts,
    maxAttempts: notificationJobs.maxAttempts,
    nextAttemptAt: notificationJobs.nextAttemptAt,
  }).from(notificationJobs)
    .where(and(
      inArray(notificationJobs.status, ['pending', 'failed']),
      lte(notificationJobs.nextAttemptAt, now),
    ))
    .orderBy(asc(notificationJobs.id))
    .limit(limit);

  const metrics: NotificationDispatchMetrics = {
    considered: candidates.length,
    claimed: 0,
    sent: 0,
    failed: 0,
    retried: 0,
    dead: 0,
    skipped: 0,
  };

  if (candidates.length === 0) {
    return metrics;
  }

  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();

  for (const candidate of candidates) {
    if (candidate.attempts >= candidate.maxAttempts) {
      metrics.dead += 1;
      continue;
    }

    const [claimed] = await db.update(notificationJobs)
      .set({
        status: 'processing',
        updatedAt: new Date(),
      })
      .where(and(
        eq(notificationJobs.id, candidate.id),
        inArray(notificationJobs.status, ['pending', 'failed']),
      ))
      .returning({
        id: notificationJobs.id,
        discordUserId: notificationJobs.discordUserId,
        content: notificationJobs.content,
        attempts: notificationJobs.attempts,
        maxAttempts: notificationJobs.maxAttempts,
      });

    if (!claimed) {
      metrics.skipped += 1;
      continue;
    }

    metrics.claimed += 1;

    if (!botToken) {
      await db.update(notificationJobs)
        .set({
          status: 'failed',
          attempts: claimed.maxAttempts,
          nextAttemptAt: new Date(),
          lastError: 'DISCORD_BOT_TOKEN is not configured',
          updatedAt: new Date(),
        })
        .where(eq(notificationJobs.id, claimed.id));

      metrics.failed += 1;
      metrics.dead += 1;
      continue;
    }

    try {
      const result = await sendDiscordDms(botToken, [claimed.discordUserId], claimed.content, 1);
      const nextAttempts = claimed.attempts + 1;

      if (result.delivered > 0) {
        await db.update(notificationJobs)
          .set({
            status: 'sent',
            attempts: nextAttempts,
            sentAt: new Date(),
            lastError: null,
            updatedAt: new Date(),
          })
          .where(eq(notificationJobs.id, claimed.id));

        metrics.sent += 1;
      } else {
        const isDead = nextAttempts >= claimed.maxAttempts;
        await db.update(notificationJobs)
          .set({
            status: 'failed',
            attempts: nextAttempts,
            nextAttemptAt: new Date(Date.now() + retryDelayMs(nextAttempts)),
            lastError: 'Discord delivery returned zero successful recipients',
            updatedAt: new Date(),
          })
          .where(eq(notificationJobs.id, claimed.id));

        metrics.failed += 1;
        if (isDead) {
          metrics.dead += 1;
        } else {
          metrics.retried += 1;
        }
      }
    } catch (error) {
      const nextAttempts = claimed.attempts + 1;
      const isDead = nextAttempts >= claimed.maxAttempts;

      await db.update(notificationJobs)
        .set({
          status: 'failed',
          attempts: nextAttempts,
          nextAttemptAt: new Date(Date.now() + retryDelayMs(nextAttempts)),
          lastError: formatError(error),
          updatedAt: new Date(),
        })
        .where(eq(notificationJobs.id, claimed.id));

      metrics.failed += 1;
      if (isDead) {
        metrics.dead += 1;
      } else {
        metrics.retried += 1;
      }

      console.error('[notifications] Job delivery failed', {
        runId: options?.runId,
        jobId: claimed.id,
        error,
      });
    }
  }

  return metrics;
}

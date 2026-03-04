import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { discordUserLinks } from '@/lib/db/schema';
import { formatTradeEventMessage } from '@/lib/discord-notify';
import { enqueueNotificationJob, notificationDedupeKey } from '@/lib/notification-jobs';
import { requireServiceClaims } from '@/lib/service-request';

const VALID_EVENTS = ['trade_imported', 'sync_complete'] as const;
type TradeEvent = (typeof VALID_EVENTS)[number];

const RATE_LIMIT_MS = 30_000;

export async function POST(request: NextRequest) {
  const db = getDb();
  if (!db) {
    return Response.json({ error: 'Database not configured' }, { status: 503 });
  }
  const claimsState = await requireServiceClaims(request, db, {
    requiredScopes: ['webhooks:trade-event'],
    enforceReplay: true,
  });
  if ('error' in claimsState) return claimsState.error;

  const body = (await request.json()) as { event?: string; userId?: string; data?: unknown };

  if (!body.event || !VALID_EVENTS.includes(body.event as TradeEvent)) {
    return Response.json({ error: `Invalid event. Must be one of: ${VALID_EVENTS.join(', ')}` }, { status: 400 });
  }

  if (!body.userId) {
    return Response.json({ error: 'userId is required' }, { status: 400 });
  }

  const runId = randomUUID();

  const links = await db.select({
    discordUserId: discordUserLinks.discordUserId,
  }).from(discordUserLinks)
    .where(eq(discordUserLinks.userId, body.userId));

  if (links.length === 0) {
    return Response.json({ received: true, event: body.event, forwarded: false, reason: 'no_link' });
  }

  const content = formatTradeEventMessage(body.event as TradeEvent, body.data);
  const discordUsers = Array.from(new Set(links.map((link) => link.discordUserId).filter(Boolean)));
  const dedupeBucket = Math.floor(Date.now() / RATE_LIMIT_MS);
  let queued = 0;
  let duplicates = 0;

  for (const discordUserId of discordUsers) {
    const dedupeKey = notificationDedupeKey('trade_event', [body.userId, body.event, discordUserId, dedupeBucket]);
    const result = await enqueueNotificationJob(db, {
      type: 'trade_event',
      discordUserId,
      content,
      dedupeKey,
      maxAttempts: 5,
    });

    if (result.enqueued) {
      queued += 1;
    } else {
      duplicates += 1;
    }
  }

  console.info('[webhook:trade-event] queued notifications', {
    runId,
    event: body.event,
    userId: body.userId,
    attempted: discordUsers.length,
    queued,
    duplicates,
  });

  return Response.json({
    runId,
    received: true,
    event: body.event,
    forwarded: queued > 0,
    queued,
    duplicates,
    attempted: discordUsers.length,
  });
}

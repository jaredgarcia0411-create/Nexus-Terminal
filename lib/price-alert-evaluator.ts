import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { discordUserLinks, priceAlerts } from '@/lib/db/schema';
import { enqueueNotificationJob, notificationDedupeKey } from '@/lib/notification-jobs';
import { getValidSchwabToken } from '@/lib/schwab';

type QuoteKey = `${string}:${string}`;

export type PriceAlertEvaluationResult = {
  evaluated: number;
  triggered: number;
  queuedNotifications: number;
  duplicateNotifications: number;
  notifiedUsers: number;
};

async function fetchLatestClose(db: Db, userId: string, symbol: string) {
  const token = await getValidSchwabToken(db, userId);
  if (!token) return null;

  const apiBase = process.env.SCHWAB_API_BASE_URL || 'https://api.schwabapi.com';
  const url = new URL('/marketdata/v1/pricehistory', apiBase);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('periodType', 'day');
  url.searchParams.set('period', '1');
  url.searchParams.set('frequencyType', 'minute');
  url.searchParams.set('frequency', '1');
  url.searchParams.set('needExtendedHoursData', 'false');

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  const payload = (await res.json().catch(() => ({}))) as { candles?: Array<{ close?: number }> };
  if (!res.ok || !payload.candles || payload.candles.length === 0) {
    return null;
  }

  const last = payload.candles[payload.candles.length - 1];
  const close = Number(last?.close ?? NaN);
  return Number.isFinite(close) ? close : null;
}

export async function evaluatePriceAlerts(
  db: Db,
  options?: { maxAlerts?: number; runId?: string },
): Promise<PriceAlertEvaluationResult> {
  const maxAlerts = Math.max(1, Math.min(options?.maxAlerts ?? 200, 500));

  const alerts = await db.select({
    id: priceAlerts.id,
    userId: priceAlerts.userId,
    symbol: priceAlerts.symbol,
    condition: priceAlerts.condition,
    targetPrice: priceAlerts.targetPrice,
  }).from(priceAlerts)
    .where(eq(priceAlerts.triggered, false))
    .limit(maxAlerts);

  if (alerts.length === 0) {
    return {
      evaluated: 0,
      triggered: 0,
      queuedNotifications: 0,
      duplicateNotifications: 0,
      notifiedUsers: 0,
    };
  }

  const quoteCache = new Map<QuoteKey, number | null>();
  const triggeredAlertIds: number[] = [];
  const notificationLines = new Map<string, string[]>();

  for (const alert of alerts) {
    const cacheKey = `${alert.userId}:${alert.symbol}` as QuoteKey;
    let lastPrice = quoteCache.get(cacheKey);
    if (lastPrice === undefined) {
      lastPrice = await fetchLatestClose(db, alert.userId, alert.symbol);
      quoteCache.set(cacheKey, lastPrice);
    }

    if (lastPrice == null) continue;

    const isTriggered = alert.condition === 'above'
      ? lastPrice >= alert.targetPrice
      : lastPrice <= alert.targetPrice;

    if (!isTriggered) continue;

    triggeredAlertIds.push(alert.id);
    const line = `${alert.symbol} is ${alert.condition} ${alert.targetPrice.toFixed(2)} (current ${lastPrice.toFixed(2)})`;
    const lines = notificationLines.get(alert.userId) ?? [];
    lines.push(line);
    notificationLines.set(alert.userId, lines);
  }

  if (triggeredAlertIds.length > 0) {
    await db.update(priceAlerts)
      .set({ triggered: true })
      .where(and(eq(priceAlerts.triggered, false), inArray(priceAlerts.id, triggeredAlertIds)));
  }

  let queuedNotifications = 0;
  let duplicateNotifications = 0;

  if (notificationLines.size > 0) {
    const userIds = Array.from(notificationLines.keys());
    const links = await db.select({
      userId: discordUserLinks.userId,
      discordUserId: discordUserLinks.discordUserId,
    }).from(discordUserLinks)
      .where(inArray(discordUserLinks.userId, userIds));

    const discordIdsByUser = new Map<string, string[]>();
    for (const link of links) {
      const current = discordIdsByUser.get(link.userId) ?? [];
      current.push(link.discordUserId);
      discordIdsByUser.set(link.userId, current);
    }

    const dedupeBucket = Math.floor(Date.now() / 60_000);
    for (const userId of userIds) {
      const lines = notificationLines.get(userId) ?? [];
      const discordIds = Array.from(new Set(discordIdsByUser.get(userId) ?? []));
      if (lines.length === 0 || discordIds.length === 0) continue;

      const content = `Price alert triggered:\n${lines.slice(0, 5).map((line) => `• ${line}`).join('\n')}`;
      for (const discordUserId of discordIds) {
        const dedupeKey = notificationDedupeKey('price_alert', [userId, discordUserId, dedupeBucket]);
        const queued = await enqueueNotificationJob(db, {
          type: 'price_alert',
          discordUserId,
          content,
          dedupeKey,
          maxAttempts: 5,
        });

        if (queued.enqueued) {
          queuedNotifications += 1;
        } else {
          duplicateNotifications += 1;
        }
      }
    }
  }

  const notifiedUsers = notificationLines.size;

  console.info('[alerts:evaluate] Evaluation run complete', {
    runId: options?.runId,
    evaluated: alerts.length,
    triggered: triggeredAlertIds.length,
    queuedNotifications,
    duplicateNotifications,
    notifiedUsers,
  });

  return {
    evaluated: alerts.length,
    triggered: triggeredAlertIds.length,
    queuedNotifications,
    duplicateNotifications,
    notifiedUsers,
  };
}

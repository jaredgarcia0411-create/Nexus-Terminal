import { getDb } from '@/lib/db';
import { importedResearchReports } from '@/lib/db/schema';
import { fetchAllMessages, requireDiscordConfig, saveDiscordReports } from '@/lib/discord/client';
import { parseMessages } from '@/lib/discord/parser';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { and, desc, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/discord/import
 *
 * Bulk import: fetches ALL messages from the configured Discord channel,
 * parses research reports, and stores them. Skips duplicates via
 * discordMessageId unique constraint.
 */
export async function POST() {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return dbUnavailable();

  await ensureUser(db, authState.user);
  const userId = authState.user.id;

  const discordConfig = requireDiscordConfig();
  if (discordConfig instanceof Response) return discordConfig;
  const { botToken, channelId } = discordConfig;

  try {
    const messages = await fetchAllMessages(channelId, botToken, (batchSize, total) => {
      console.info(`[discord-import] Fetched batch of ${batchSize}, total: ${total}`);
    });

    const parsed = parseMessages(messages);
    const { imported, tickers } = await saveDiscordReports(db, userId, parsed, 'discord-import');
    const skipped = parsed.length - imported;

    return Response.json({
      imported,
      skipped,
      total: messages.length,
      reportsFound: parsed.length,
      tickers: Array.from(tickers).sort(),
      tickerCount: tickers.size,
    });
  } catch (error) {
    logRouteError('discord-import', error);
    return internalServerError();
  }
}

/**
 * GET /api/discord/import
 *
 * List imported reports. Optional query params:
 * - ticker: filter by ticker symbol
 * - limit: max results (default 50, max 200)
 */
export async function GET(request: Request) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return dbUnavailable();

  const url = new URL(request.url);
  const ticker = url.searchParams.get('ticker')?.toUpperCase();
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 200);

  try {
    let query = db.select().from(importedResearchReports)
      .where(eq(importedResearchReports.userId, authState.user.id))
      .orderBy(desc(importedResearchReports.reportDate))
      .limit(limit);

    if (ticker) {
      query = db.select().from(importedResearchReports)
        .where(
          and(
            eq(importedResearchReports.userId, authState.user.id),
            eq(importedResearchReports.ticker, ticker),
          ),
        )
        .orderBy(desc(importedResearchReports.reportDate))
        .limit(limit);
    }

    const reports = await query;
    return Response.json({ reports, count: reports.length });
  } catch (error) {
    logRouteError('discord-import-list', error);
    return internalServerError();
  }
}

import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { dbUnavailable, requireCronSecret } from '@/lib/server-db-utils';
import { getDb } from '@/lib/db';
import { importedResearchReports } from '@/lib/db/schema';
import { fetchNewMessages, requireDiscordConfig, saveDiscordReports } from '@/lib/discord/client';
import { parseMessages } from '@/lib/discord/parser';
import { desc, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/discord/cron/sync
 *
 * Vercel cron job — syncs new Discord messages for all users who have
 * previously imported reports. Authenticated via CRON_SECRET Bearer token.
 */
export async function GET(request: Request) {
  try {
    const authError = requireCronSecret(request);
    if (authError) return authError;

    const db = getDb();
    if (!db) {
      return dbUnavailable();
    }

    const discordConfig = requireDiscordConfig();
    if (discordConfig instanceof Response) return discordConfig;
    const { botToken, channelId } = discordConfig;

    // Find all users who have at least one imported report
    const userRows = await db
      .selectDistinct({ userId: importedResearchReports.userId })
      .from(importedResearchReports);

    if (userRows.length === 0) {
      return Response.json({ success: true, message: 'No users with imports found', synced: [] });
    }

    const results: Array<{ userId: string; imported: number; tickers: string[] }> = [];

    for (const { userId } of userRows) {
      try {
        // Get the latest discordMessageId for this user
        const [latest] = await db
          .select({ discordMessageId: importedResearchReports.discordMessageId })
          .from(importedResearchReports)
          .where(eq(importedResearchReports.userId, userId))
          .orderBy(desc(importedResearchReports.reportDate))
          .limit(1);

        if (!latest?.discordMessageId) continue;

        const messages = await fetchNewMessages(channelId, botToken, latest.discordMessageId);
        if (messages.length === 0) continue;

        const parsed = parseMessages(messages);
        const { imported, tickers } = await saveDiscordReports(db, userId, parsed, 'discord-cron-sync');

        if (imported > 0) {
          results.push({ userId, imported, tickers: Array.from(tickers).sort() });
        }
      } catch (error) {
        console.error(`[discord-cron-sync] Failed to sync for user ${userId}:`, error);
      }
    }

    return Response.json({ success: true, synced: results });
  } catch (error) {
    logRouteError('discord-cron-sync', error);
    return internalServerError();
  }
}

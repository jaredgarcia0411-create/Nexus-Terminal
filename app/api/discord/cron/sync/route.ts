import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { importedResearchReports } from '@/lib/db/schema';
import { fetchNewMessages } from '@/lib/discord/client';
import { parseMessages } from '@/lib/discord/parser';
import { updateTickerSummary } from '@/lib/jarvis/historical-summary';
import { desc, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function requireCronSecret(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return Response.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 });
  }

  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token || token !== secret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}

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
      return Response.json({ error: 'Database not configured' }, { status: 503 });
    }

    const botToken = process.env.DISCORD_BOT_TOKEN;
    const channelId = process.env.DISCORD_CHANNEL_ID;

    if (!botToken || !channelId) {
      return Response.json(
        { error: 'DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID must be set' },
        { status: 503 },
      );
    }

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
        let imported = 0;
        const tickers = new Set<string>();

        for (const report of parsed) {
          try {
            await db.insert(importedResearchReports).values({
              id: crypto.randomUUID(),
              userId,
              ticker: report.data.ticker,
              reportDate: new Date(report.timestamp),
              source: 'discord_import',
              discordMessageId: report.messageId,
              rawText: report.rawText,
              parsedJson: report.data,
            }).onConflictDoNothing();

            imported++;
            tickers.add(report.data.ticker);
          } catch (error) {
            console.error(`[discord-cron-sync] Failed to insert report ${report.messageId}:`, error);
          }
        }

        for (const ticker of tickers) {
          try {
            await updateTickerSummary(userId, ticker);
          } catch (error) {
            console.error(`[discord-cron-sync] Failed to update summary for ${ticker}:`, error);
          }
        }

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

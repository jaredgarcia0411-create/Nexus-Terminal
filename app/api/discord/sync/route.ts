import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { importedResearchReports } from '@/lib/db/schema';
import { fetchNewMessages } from '@/lib/discord/client';
import { parseMessages } from '@/lib/discord/parser';
import { ensureUser, requireUser } from '@/lib/server-db-utils';
import { desc, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/discord/sync
 *
 * Incremental sync: fetches only NEW messages since the last import.
 */
export async function POST() {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return Response.json({ error: 'Database not configured' }, { status: 503 });

  await ensureUser(db, authState.user);
  const userId = authState.user.id;

  const botToken = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.DISCORD_CHANNEL_ID;

  if (!botToken || !channelId) {
    return Response.json(
      { error: 'DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID must be set' },
      { status: 400 },
    );
  }

  try {
    const [latest] = await db.select({ discordMessageId: importedResearchReports.discordMessageId })
      .from(importedResearchReports)
      .where(eq(importedResearchReports.userId, userId))
      .orderBy(desc(importedResearchReports.reportDate))
      .limit(1);

    if (!latest?.discordMessageId) {
      return Response.json(
        { error: 'No previous imports found. Run POST /api/discord/import first.' },
        { status: 400 },
      );
    }

    const messages = await fetchNewMessages(channelId, botToken, latest.discordMessageId);

    if (messages.length === 0) {
      return Response.json({ imported: 0, message: 'No new messages found' });
    }

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
        console.error(`[discord-sync] Failed to insert report ${report.messageId}:`, error);
      }
    }

    return Response.json({
      imported,
      newMessages: messages.length,
      reportsFound: parsed.length,
      tickers: Array.from(tickers).sort(),
    });
  } catch (error) {
    logRouteError('discord-sync', error);
    return internalServerError();
  }
}

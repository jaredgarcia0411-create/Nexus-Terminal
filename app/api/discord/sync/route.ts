import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { importedResearchReports } from '@/lib/db/schema';
import { fetchNewMessages, requireDiscordConfig, saveDiscordReports } from '@/lib/discord/client';
import { parseMessages } from '@/lib/discord/parser';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
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
  if (!db) return dbUnavailable();

  await ensureUser(db, authState.user);
  const userId = authState.user.id;

  const discordConfig = requireDiscordConfig();
  if (discordConfig instanceof Response) return discordConfig;
  const { botToken, channelId } = discordConfig;

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
    const { imported, tickers } = await saveDiscordReports(db, userId, parsed, 'discord-sync');

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

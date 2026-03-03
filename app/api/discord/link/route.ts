import { getDb } from '@/lib/db';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';

export async function GET() {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return dbUnavailable();
  await ensureUser(db, authState.user);

  const result = await db.execute({
    sql: 'SELECT discord_user_id, guild_id, linked_at FROM discord_user_links WHERE user_id = ?',
    args: [authState.user.id],
  });

  const links = result.rows.map((row) => ({
    discordUserId: String(row.discord_user_id),
    guildId: String(row.guild_id),
    linkedAt: String(row.linked_at),
  }));

  return Response.json({ links });
}

export async function POST(request: Request) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return dbUnavailable();
  await ensureUser(db, authState.user);

  const body = (await request.json()) as { discordUserId?: string; guildId?: string };
  const discordUserId = body.discordUserId?.trim();
  const guildId = body.guildId?.trim();

  if (!discordUserId || !guildId) {
    return Response.json({ error: 'discordUserId and guildId are required' }, { status: 400 });
  }

  await db.execute({
    sql: `
      INSERT INTO discord_user_links (user_id, discord_user_id, guild_id)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, discord_user_id) DO UPDATE SET
        guild_id = excluded.guild_id,
        linked_at = datetime('now')
    `,
    args: [authState.user.id, discordUserId, guildId],
  });

  return Response.json({ success: true });
}

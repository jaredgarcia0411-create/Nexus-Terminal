import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { discordUserLinks } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';

export async function GET() {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return dbUnavailable();
  await ensureUser(db, authState.user);

  const rows = await db.select({
    discordUserId: discordUserLinks.discordUserId,
    guildId: discordUserLinks.guildId,
    linkedAt: discordUserLinks.linkedAt,
  }).from(discordUserLinks)
    .where(eq(discordUserLinks.userId, authState.user.id))
    .orderBy(desc(discordUserLinks.linkedAt));

  const links = rows.map((row) => ({
    discordUserId: row.discordUserId,
    guildId: row.guildId,
    linkedAt: row.linkedAt?.toISOString() ?? '',
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

  await db.insert(discordUserLinks)
    .values({
      userId: authState.user.id,
      discordUserId,
      guildId,
      linkedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [discordUserLinks.userId, discordUserLinks.discordUserId],
      set: {
        guildId,
        linkedAt: new Date(),
      },
    });

  const [link] = await db.select({
    discordUserId: discordUserLinks.discordUserId,
    guildId: discordUserLinks.guildId,
    linkedAt: discordUserLinks.linkedAt,
  }).from(discordUserLinks)
    .where(and(eq(discordUserLinks.userId, authState.user.id), eq(discordUserLinks.discordUserId, discordUserId)))
    .limit(1);

  return Response.json({
    link: link
      ? {
          discordUserId: link.discordUserId,
          guildId: link.guildId,
          linkedAt: link.linkedAt?.toISOString() ?? '',
        }
      : null,
  });
}

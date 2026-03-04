import { and, desc, eq } from 'drizzle-orm';
import { type Db } from '@/lib/db';
import { discordUserLinks, users } from '@/lib/db/schema';
import { requireUser } from '@/lib/server-db-utils';

type AuthenticatedUser = {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
};

export type AuthContext = {
  source: 'session' | 'service';
  user: AuthenticatedUser;
};

function hasValidServiceSecret(request: Request) {
  const secret = process.env.TRADE_WEBHOOK_SECRET;
  if (!secret) return false;
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${secret}`;
}

export async function requireServiceUser(request: Request, db: Db): Promise<AuthContext | { error: Response }> {
  if (!hasValidServiceSecret(request)) {
    return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const discordUserId = request.headers.get('x-discord-user-id')?.trim();
  const guildId = request.headers.get('x-discord-guild-id')?.trim();
  if (!discordUserId) {
    return { error: Response.json({ error: 'Missing x-discord-user-id header' }, { status: 400 }) };
  }

  const linkQuery = db.select({
    userId: discordUserLinks.userId,
  }).from(discordUserLinks);

  const [link] = guildId
    ? await linkQuery
      .where(and(eq(discordUserLinks.discordUserId, discordUserId), eq(discordUserLinks.guildId, guildId)))
      .limit(1)
    : await linkQuery
      .where(eq(discordUserLinks.discordUserId, discordUserId))
      .orderBy(desc(discordUserLinks.linkedAt))
      .limit(1);

  if (!link) {
    return { error: Response.json({ error: 'Discord account is not linked to a Nexus user' }, { status: 403 }) };
  }

  const [userRow] = await db.select({
    id: users.id,
    email: users.email,
    name: users.name,
    picture: users.picture,
  }).from(users)
    .where(eq(users.id, link.userId))
    .limit(1);

  if (!userRow) {
    return { error: Response.json({ error: 'Linked Nexus user not found' }, { status: 404 }) };
  }

  return {
    source: 'service',
    user: {
      id: userRow.id,
      email: userRow.email,
      name: userRow.name ?? null,
      picture: userRow.picture ?? null,
    },
  };
}

export async function requireUserOrService(request: Request, db: Db): Promise<AuthContext | { error: Response }> {
  const sessionState = await requireUser();
  if (!('error' in sessionState)) {
    return {
      source: 'session',
      user: sessionState.user,
    };
  }

  return requireServiceUser(request, db);
}

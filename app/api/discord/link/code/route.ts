import { randomInt } from 'node:crypto';
import { and, eq, lt, gt } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { discordLinkCodes, discordUserLinks } from '@/lib/db/schema';
import { requireServiceClaims } from '@/lib/service-request';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';

const CODE_LENGTH = 6;
const CODE_TTL_MINUTES = 10;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateLinkCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  }
  return code;
}

export async function POST(request: Request) {
  const db = getDb();
  if (!db) return dbUnavailable();
  const claimsState = await requireServiceClaims(request, db, {
    requiredScopes: ['link:code:create'],
    enforceReplay: true,
  });
  if ('error' in claimsState) return claimsState.error;
  const claims = claimsState.claims;

  const discordUserId = claims.discordUserId?.trim();
  const guildId = claims.guildId?.trim();
  if (!discordUserId || !guildId) {
    return Response.json({ error: 'Service token missing discordUserId/guildId claims' }, { status: 400 });
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MINUTES * 60_000);

  await db.delete(discordLinkCodes).where(lt(discordLinkCodes.expiresAt, now));
  await db.delete(discordLinkCodes).where(eq(discordLinkCodes.discordUserId, discordUserId));

  let code = generateLinkCode();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existing = await db.select({ code: discordLinkCodes.code })
      .from(discordLinkCodes)
      .where(eq(discordLinkCodes.code, code))
      .limit(1);
    if (existing.length === 0) break;
    code = generateLinkCode();
  }

  await db.insert(discordLinkCodes).values({
    code,
    discordUserId,
    guildId,
    expiresAt,
  });

  return Response.json({
    code,
    expiresAt: expiresAt.toISOString(),
    ttlMinutes: CODE_TTL_MINUTES,
  });
}

export async function PUT(request: Request) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return dbUnavailable();
  await ensureUser(db, authState.user);

  const body = (await request.json().catch(() => ({}))) as { code?: string };
  const code = body.code?.trim().toUpperCase();
  if (!code) {
    return Response.json({ error: 'code is required' }, { status: 400 });
  }

  const now = new Date();
  const [linkCode] = await db.select({
    code: discordLinkCodes.code,
    discordUserId: discordLinkCodes.discordUserId,
    guildId: discordLinkCodes.guildId,
    expiresAt: discordLinkCodes.expiresAt,
  }).from(discordLinkCodes)
    .where(and(eq(discordLinkCodes.code, code), gt(discordLinkCodes.expiresAt, now)))
    .limit(1);

  if (!linkCode) {
    return Response.json({ error: 'Invalid or expired code' }, { status: 400 });
  }

  await db.delete(discordUserLinks)
    .where(and(eq(discordUserLinks.discordUserId, linkCode.discordUserId), eq(discordUserLinks.guildId, linkCode.guildId)));

  await db.insert(discordUserLinks)
    .values({
      userId: authState.user.id,
      discordUserId: linkCode.discordUserId,
      guildId: linkCode.guildId,
      linkedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [discordUserLinks.userId, discordUserLinks.discordUserId],
      set: {
        guildId: linkCode.guildId,
        linkedAt: new Date(),
      },
    });

  await db.delete(discordLinkCodes).where(eq(discordLinkCodes.code, code));

  return Response.json({
    linked: true,
    link: {
      discordUserId: linkCode.discordUserId,
      guildId: linkCode.guildId,
    },
  });
}

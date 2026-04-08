import { and, eq, inArray, or } from 'drizzle-orm';
import { type Db, type PoolDb } from '@/lib/db';
import { users, trades, tradeTags } from '@/lib/db/schema';
import type { ApiTrade } from '@/lib/types';

type QueryDb = Db | PoolDb;

export interface AuthUserIdentity {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
}

export async function requireUser() {
  const { auth } = await import('@/lib/auth-config');
  const session = await auth();
  const user = session?.user as ({ id?: string; email?: string | null; name?: string | null; image?: string | null } | undefined);
  if (!user?.id || !user.email) {
    return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name ?? null,
      picture: user.image ?? null,
    },
  };
}

export async function ensureUser(db: QueryDb, user: AuthUserIdentity): Promise<AuthUserIdentity> {
  const existingUsers = await db.select({ id: users.id, email: users.email, name: users.name, picture: users.picture })
    .from(users)
    .where(or(eq(users.id, user.id), eq(users.email, user.email)));

  const userById = existingUsers.find((row) => row.id === user.id);
  if (userById) {
    if (userById.name !== user.name || userById.picture !== user.picture) {
      await db.update(users)
        .set({ name: user.name, picture: user.picture })
        .where(eq(users.id, user.id));
    }
    return {
      id: userById.id,
      email: userById.email,
      name: user.name,
      picture: user.picture,
    };
  }

  const userByEmail = existingUsers.find((row) => row.email === user.email);
  if (userByEmail) {
    // Remap session ID to the DB's canonical ID. This mutates the passed-in
    // user object so callers that use authState.user.id get the right ID.
    user.id = userByEmail.id;
    if (userByEmail.name !== user.name || userByEmail.picture !== user.picture) {
      await db.update(users)
        .set({ name: user.name, picture: user.picture })
        .where(eq(users.id, user.id));
    }
    return {
      id: userByEmail.id,
      email: userByEmail.email,
      name: user.name,
      picture: user.picture,
    };
  }

  try {
    await db.insert(users)
      .values({ id: user.id, email: user.email, name: user.name, picture: user.picture })
      .onConflictDoUpdate({
        target: users.id,
        set: { name: user.name, picture: user.picture },
      });
  } catch (error) {
    const errorCode = (error as { code?: unknown }).code;
    if (typeof errorCode === 'string' && errorCode === '23505') {
      const [canonicalUser] = await db.select({ id: users.id, name: users.name, picture: users.picture })
        .from(users)
        .where(eq(users.email, user.email));

      if (!canonicalUser) {
        throw error;
      }

      user.id = canonicalUser.id;
      if (canonicalUser.name !== user.name || canonicalUser.picture !== user.picture) {
        await db.update(users)
          .set({ name: user.name, picture: user.picture })
          .where(eq(users.id, canonicalUser.id));
      }
      return {
        id: canonicalUser.id,
        email: user.email,
        name: user.name,
        picture: user.picture,
      };
    }

    throw error;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
  };
}

export function dbUnavailable() {
  return Response.json({ error: 'Database not configured' }, { status: 503 });
}

export function requireCronSecret(request: Request): Response | null {
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

export function toTrade(
  row: typeof trades.$inferSelect,
  tags: string[] = [],
  rawExecutions: ApiTrade['rawExecutions'] = [],
): ApiTrade {
  const commission = row.commission ?? 0;
  const fees = row.fees ?? 0;
  const netPnl = row.netPnl === 0 && row.pnl !== 0 ? row.pnl : row.netPnl;
  const grossPnl = row.grossPnl === 0 ? netPnl + commission + fees : row.grossPnl;
  const executionCount = row.executionCount === 1 && row.executions !== 1 ? row.executions : row.executionCount;
  return {
    id: row.id,
    date: row.date,
    sortKey: row.sortKey,
    symbol: row.symbol,
    direction: row.direction,
    avgEntryPrice: row.avgEntryPrice,
    avgExitPrice: row.avgExitPrice,
    totalQuantity: row.totalQuantity,
    grossPnl,
    netPnl,
    entryTime: row.entryTime,
    exitTime: row.exitTime,
    executionCount,
    rawExecutions,
    mfe: row.mfe ?? undefined,
    mae: row.mae ?? undefined,
    bestExitPnl: row.bestExitPnl ?? undefined,
    exitEfficiency: row.exitEfficiency ?? undefined,
    pnl: netPnl,
    executions: executionCount,
    initialRisk: row.initialRisk ?? undefined,
    commission,
    fees,
    tags,
    notes: row.notes ?? undefined,
  };
}

export async function loadTagsForTradeIds(db: QueryDb, userId: string, tradeIds: string[]) {
  if (tradeIds.length === 0) return new Map<string, string[]>();

  const rows = await db.select()
    .from(tradeTags)
    .where(and(eq(tradeTags.userId, userId), inArray(tradeTags.tradeId, tradeIds)));

  const tagMap = new Map<string, string[]>();
  for (const row of rows) {
    const list = tagMap.get(row.tradeId) ?? [];
    list.push(row.tag);
    tagMap.set(row.tradeId, list);
  }

  return tagMap;
}

export function toExecutionRowId(userId: string, tradeId: string, executionId: string | undefined, index: number): string {
  const normalized = String(executionId ?? '').trim();
  if (normalized.startsWith(`${userId}:`)) {
    return normalized;
  }

  if (normalized.length > 0) {
    return `${userId}:${normalized}`;
  }

  return `${userId}:${tradeId}:${index}`;
}

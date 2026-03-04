import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { priceAlerts } from '@/lib/db/schema';
import { requireServiceUser } from '@/lib/service-auth';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';

async function resolveAlertUser(request: Request, db: NonNullable<ReturnType<typeof getDb>>) {
  const sessionState = await requireUser();
  if (!('error' in sessionState)) {
    await ensureUser(db, sessionState.user);
    return { userId: sessionState.user.id };
  }

  const serviceState = await requireServiceUser(request, db);
  if ('error' in serviceState) return serviceState;

  return { userId: serviceState.user.id };
}

export async function GET(request: Request) {
  const db = getDb();
  if (!db) return dbUnavailable();

  const userState = await resolveAlertUser(request, db);
  if ('error' in userState) return userState.error;

  const rows = await db.select({
    id: priceAlerts.id,
    symbol: priceAlerts.symbol,
    condition: priceAlerts.condition,
    targetPrice: priceAlerts.targetPrice,
    createdAt: priceAlerts.createdAt,
  }).from(priceAlerts)
    .where(and(eq(priceAlerts.userId, userState.userId), eq(priceAlerts.triggered, false)))
    .orderBy(desc(priceAlerts.createdAt));

  const alerts = rows.map((row) => ({
    id: row.id,
    symbol: row.symbol,
    condition: row.condition,
    targetPrice: row.targetPrice,
    createdAt: row.createdAt?.toISOString() ?? '',
  }));

  return Response.json({ alerts });
}

export async function POST(request: Request) {
  const db = getDb();
  if (!db) return dbUnavailable();

  const userState = await resolveAlertUser(request, db);
  if ('error' in userState) return userState.error;

  const body = (await request.json()) as {
    symbol?: string;
    condition?: string;
    targetPrice?: number;
    price?: number;
  };
  const symbol = body.symbol?.trim().toUpperCase();
  const condition = body.condition?.trim();
  const targetPrice = body.targetPrice ?? body.price;

  if (!symbol) {
    return Response.json({ error: 'symbol is required' }, { status: 400 });
  }

  if (condition !== 'above' && condition !== 'below') {
    return Response.json({ error: "condition must be 'above' or 'below'" }, { status: 400 });
  }

  if (targetPrice == null || typeof targetPrice !== 'number' || Number.isNaN(targetPrice)) {
    return Response.json({ error: 'targetPrice must be a valid number' }, { status: 400 });
  }

  const [alert] = await db.insert(priceAlerts)
    .values({
      userId: userState.userId,
      symbol,
      condition,
      targetPrice,
      triggered: false,
    })
    .returning({
      id: priceAlerts.id,
      symbol: priceAlerts.symbol,
      condition: priceAlerts.condition,
      targetPrice: priceAlerts.targetPrice,
    });

  if (!alert) {
    return Response.json({ error: 'Could not create alert' }, { status: 500 });
  }

  return Response.json({ alert });
}

import { and, desc, eq } from 'drizzle-orm';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { careerPnlEntries } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { careerPnlBodySchema } from '@/lib/validations/system';

// Normalize any YYYY-MM-DD to the first of that month so the unique
// (user_id, month) constraint dedupes correctly regardless of which day
// in the month the client sends.
function normalizeToMonthStart(isoDate: string): string {
  const [year, month] = isoDate.split('-');
  return `${year}-${month}-01`;
}

export async function GET() {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const rows = await db.select({
      id: careerPnlEntries.id,
      month: careerPnlEntries.month,
      amount: careerPnlEntries.amount,
      notes: careerPnlEntries.notes,
    })
      .from(careerPnlEntries)
      .where(eq(careerPnlEntries.userId, authState.user.id))
      .orderBy(desc(careerPnlEntries.month));

    return Response.json({ entries: rows });
  } catch (error) {
    logRouteError('career-pnl.get', error);
    return internalServerError();
  }
}

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const bodyState = await parseAndValidate(request, careerPnlBodySchema);
    if (bodyState.error) return bodyState.error;
    const { month, amount, notes } = bodyState.data;

    const normalizedMonth = normalizeToMonthStart(month);

    // Upsert: if user already has an entry for this month, update it.
    // The (user_id, month) unique index enables this; without it the insert
    // would error on duplicate.
    const [row] = await db.insert(careerPnlEntries)
      .values({
        userId: authState.user.id,
        month: normalizedMonth,
        amount,
        notes: notes ?? null,
      })
      .onConflictDoUpdate({
        target: [careerPnlEntries.userId, careerPnlEntries.month],
        set: {
          amount,
          notes: notes ?? null,
          updatedAt: new Date(),
        },
      })
      .returning({
        id: careerPnlEntries.id,
        month: careerPnlEntries.month,
        amount: careerPnlEntries.amount,
        notes: careerPnlEntries.notes,
      });

    return Response.json({ entry: row });
  } catch (error) {
    logRouteError('career-pnl.post', error);
    return internalServerError();
  }
}

export async function DELETE(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const url = new URL(request.url);
    const idParam = url.searchParams.get('id');
    const id = idParam ? Number(idParam) : NaN;
    if (!Number.isFinite(id) || id <= 0) {
      return Response.json({ error: 'id query param is required' }, { status: 400 });
    }

    // Scope by userId so users can't delete each other's rows even with a
    // guessed id.
    const result = await db.delete(careerPnlEntries)
      .where(and(eq(careerPnlEntries.id, id), eq(careerPnlEntries.userId, authState.user.id)))
      .returning({ id: careerPnlEntries.id });

    if (result.length === 0) {
      return Response.json({ error: 'entry not found' }, { status: 404 });
    }
    return Response.json({ success: true, id: result[0].id });
  } catch (error) {
    logRouteError('career-pnl.delete', error);
    return internalServerError();
  }
}

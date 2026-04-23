import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getPoolDb } from '@/lib/db';
import { systemTickers } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { systemSheetSyncBodySchema } from '@/lib/validations/system-sheet';

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getPoolDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const bodyState = await parseAndValidate(request, systemSheetSyncBodySchema);
    if (bodyState.error) return bodyState.error;
    const { rows } = bodyState.data;

    let inserted = 0;
    let updated = 0;

    await db.transaction(async (tx) => {
      for (const row of rows) {
        const result = await tx.insert(systemTickers).values({
          id: randomUUID(),
          ticker: row.ticker.toUpperCase(),
          date: row.date,
          grade: row.grade,
          primaryAgenda: row.primaryAgenda,
          secondaryAgenda: row.secondaryAgenda,
          setupType: row.setupType,
          outcome: row.outcome,
          tickerWinLoss: row.tickerWinLoss,
          tickerR: row.tickerR,
          triggerCount: row.triggerCount,
          day1GapPct: row.day1GapPct,
          attemptsJson: row.attempts,
          rawJson: row.rawJson,
        }).onConflictDoUpdate({
          target: [systemTickers.ticker, systemTickers.date],
          set: {
            grade: row.grade,
            primaryAgenda: row.primaryAgenda,
            secondaryAgenda: row.secondaryAgenda,
            setupType: row.setupType,
            outcome: row.outcome,
            tickerWinLoss: row.tickerWinLoss,
            tickerR: row.tickerR,
            triggerCount: row.triggerCount,
            day1GapPct: row.day1GapPct,
            attemptsJson: row.attempts,
            rawJson: row.rawJson,
            updatedAt: sql`now()`,
          },
        }).returning({
          id: systemTickers.id,
          importedAt: systemTickers.importedAt,
          updatedAt: systemTickers.updatedAt,
        });

        const saved = result[0];
        if (!saved) continue;

        const importedMs = saved.importedAt?.getTime() ?? 0;
        const updatedMs = saved.updatedAt?.getTime() ?? 0;
        if (Math.abs(updatedMs - importedMs) < 5) inserted += 1;
        else updated += 1;
      }
    });

    return Response.json({
      inserted,
      updated,
      total: rows.length,
    });
  } catch (error) {
    logRouteError('system-sheet.sync.post', error);
    return Response.json({ error: 'Sync failed' }, { status: 500 });
  }
}

import { and, eq, inArray, sql } from 'drizzle-orm';

import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { sheetRows, sheets } from '@/lib/db/schema';
import {
  fetchGroupedDailyAggregates,
  fetchSharesOutstanding,
  isMassiveConfigured,
  normalizeMassiveTicker,
  type GroupedDailyBar,
} from '@/lib/massive-market';
import { getSheetRole } from '@/lib/sheets/access';
import { computeRowFill, getMassiveFillKeys, isEmptySheetCell, type MassiveFillKeys } from '@/lib/sheets/massive-fill';
import { applySheetTagsForDates } from '@/lib/sheets/trade-tags';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { epochToNySortKey, isNyTradingDay } from '@/lib/time-utils';
import { fillMassiveSchema } from '@/lib/validations/sheets';

function hasMassiveFillKey(keys: MassiveFillKeys): boolean {
  return Boolean(keys.shareKey || keys.dollarKey || keys.floatKey);
}

function textCell(values: Record<string, unknown>, key: string): string {
  return String(values[key] ?? '').trim();
}

function needsVolume(values: Record<string, unknown>, keys: MassiveFillKeys): boolean {
  return Boolean(
    (keys.shareKey && isEmptySheetCell(values[keys.shareKey]))
    || (keys.dollarKey && isEmptySheetCell(values[keys.dollarKey])),
  );
}

function needsTodayFloat(values: Record<string, unknown>, keys: MassiveFillKeys, today: string): boolean {
  return Boolean(
    keys.floatKey
    && textCell(values, 'date') === today
    && isEmptySheetCell(values[keys.floatKey]),
  );
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const bodyState = await parseAndValidate(request, fillMassiveSchema);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;
    const role = await getSheetRole(db, id, authState.user.id);
    if (!role) return Response.json({ error: 'Sheet not found' }, { status: 404 });
    if (role === 'viewer') return Response.json({ error: 'Forbidden' }, { status: 403 });

    if (!isMassiveConfigured()) {
      return Response.json({ error: 'Massive API is not configured' }, { status: 503 });
    }

    const [sheet] = await db
      .select({ columns: sheets.columns })
      .from(sheets)
      .where(eq(sheets.id, id))
      .limit(1);
    if (!sheet) return Response.json({ error: 'Sheet not found' }, { status: 404 });

    const keys = getMassiveFillKeys(sheet.columns);
    if (!hasMassiveFillKey(keys)) {
      return Response.json({ rows: [], filled: 0, missed: 0 });
    }

    const rows = await db
      .select()
      .from(sheetRows)
      .where(and(eq(sheetRows.sheetId, id), inArray(sheetRows.id, body.rowIds)));

    const today = epochToNySortKey(Date.now());
    const datesNeedingVolume = new Set<string>();
    const tickersNeedingFloat = new Set<string>();

    for (const row of rows) {
      const values = row.values;
      const ticker = normalizeMassiveTicker(textCell(values, 'ticker'));
      const date = textCell(values, 'date');
      if (!ticker) continue;

      if (date && isNyTradingDay(date) && needsVolume(values, keys)) {
        datesNeedingVolume.add(date);
      }

      if (needsTodayFloat(values, keys, today)) {
        tickersNeedingFloat.add(ticker);
      }
    }

    const barsByDate = new Map<string, Map<string, GroupedDailyBar>>();
    await Promise.all([...datesNeedingVolume].map(async (date) => {
      try {
        const bars = await fetchGroupedDailyAggregates(date, false);
        barsByDate.set(
          date,
          new Map(bars.map((bar) => [normalizeMassiveTicker(bar.ticker), bar])),
        );
      } catch (error) {
        console.warn(`Massive grouped aggregates unavailable for ${date}`, error);
      }
    }));

    const sharesByTicker = new Map<string, number | null>();
    const shareResults = await Promise.allSettled([...tickersNeedingFloat].map(async (ticker) => ({
      ticker,
      shares: await fetchSharesOutstanding(ticker),
    })));
    for (const result of shareResults) {
      if (result.status === 'fulfilled') {
        sharesByTicker.set(result.value.ticker, result.value.shares);
      } else {
        console.warn('Massive shares outstanding request failed', result.reason);
      }
    }

    const updatedRows: Array<typeof sheetRows.$inferSelect> = [];
    let missed = Math.max(0, body.rowIds.length - rows.length);

    for (const row of rows) {
      const values = row.values;
      const ticker = normalizeMassiveTicker(textCell(values, 'ticker'));
      const date = textCell(values, 'date');
      const bar = date ? barsByDate.get(date)?.get(ticker) ?? null : null;
      const sharesOutstanding = date === today ? sharesByTicker.get(ticker) ?? null : null;
      const fill = computeRowFill({
        values,
        keys,
        bar,
        sharesOutstanding,
        isToday: date === today,
      });

      if (Object.keys(fill).length === 0) {
        missed += 1;
        continue;
      }

      const [updated] = await db
        .update(sheetRows)
        .set({
          values: { ...values, ...fill },
          version: sql`${sheetRows.version} + 1`,
          updatedByUserId: authState.user.id,
          updatedAt: new Date(),
        })
        .where(and(eq(sheetRows.id, row.id), eq(sheetRows.sheetId, id), eq(sheetRows.version, row.version)))
        .returning();

      if (!updated) {
        missed += 1;
        continue;
      }

      updatedRows.push(updated);
    }

    await applySheetTagsForDates(
      db,
      authState.user.id,
      Array.from(new Set(updatedRows.map((row) => textCell(row.values, 'date')).filter(Boolean))),
    );

    return Response.json({ rows: updatedRows, filled: updatedRows.length, missed });
  } catch (error) {
    logRouteError('sheets.id.fill-massive.post', error);
    return internalServerError();
  }
}

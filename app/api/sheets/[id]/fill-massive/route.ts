import { and, eq, inArray, sql } from 'drizzle-orm';

import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { sheetRows, sheets } from '@/lib/db/schema';
import {
  fetchGroupedDailyAggregates,
  fetchMassiveAggregateBars,
  fetchSharesOutstanding,
  isMassiveConfigured,
  normalizeMassiveTicker,
  type GroupedDailyBar,
} from '@/lib/massive-market';
import { getSheetRole } from '@/lib/sheets/access';
import { computeRowFill, computeSessionHighs, getMassiveFillKeys, isEmptySheetCell, type MassiveFillKeys } from '@/lib/sheets/massive-fill';
import { applySheetTagsForDates } from '@/lib/sheets/trade-tags';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { getNextTradingSession, isNyTradingDay, nyDateTimeToEpoch } from '@/lib/time-utils';
import { fillMassiveSchema } from '@/lib/validations/sheets';

function hasMassiveFillKey(keys: MassiveFillKeys): boolean {
  return Object.values(keys).some(Boolean);
}

function textCell(values: Record<string, unknown>, key: string): string {
  return String(values[key] ?? '').trim();
}

function needsDaily(values: Record<string, unknown>, keys: MassiveFillKeys, force: boolean): boolean {
  const dailyKeys = [keys.shareKey, keys.dollarKey, keys.pdcKey, keys.pdRangeKey, keys.extensionKey];
  if (force) return dailyKeys.some(Boolean);
  return dailyKeys.some((key) => key && isEmptySheetCell(values[key]));
}

function needsFloat(values: Record<string, unknown>, keys: MassiveFillKeys, force: boolean): boolean {
  if (force) return Boolean(keys.floatKey);
  return Boolean(keys.floatKey && isEmptySheetCell(values[keys.floatKey]));
}

function needsSession(values: Record<string, unknown>, keys: MassiveFillKeys, force: boolean): boolean {
  const sessionKeys = [keys.ahHighKey, keys.pmEarlyKey, keys.pmLateKey, keys.extensionKey];
  if (force) return sessionKeys.some(Boolean);
  return sessionKeys.some((key) => key && isEmptySheetCell(values[key]));
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

    const datesNeedingVolume = new Set<string>();
    // Keyed by `${ticker}|${date}` so each row's float is fetched as of its own
    // date; rows sharing a ticker+date dedupe to a single request.
    const floatNeeds = new Map<string, { ticker: string; date: string }>();
    // One minute-bar request per ticker + scan date covers AH through next PM.
    const sessionNeeds = new Map<string, { ticker: string; date: string; tradeDate: string }>();
    const nowMs = Date.now();

    for (const row of rows) {
      const values = row.values;
      const ticker = normalizeMassiveTicker(textCell(values, 'ticker'));
      const date = textCell(values, 'date');
      if (!ticker) continue;

      if (date && isNyTradingDay(date) && needsDaily(values, keys, body.force)) {
        datesNeedingVolume.add(date);
      }

      if (date && needsFloat(values, keys, body.force)) {
        floatNeeds.set(`${ticker}|${date}`, { ticker, date });
      }

      const tradeDate = date && isNyTradingDay(date) ? getNextTradingSession(date) : null;
      // Before AH closes, none of the session windows can be written.
      if (tradeDate && nowMs >= nyDateTimeToEpoch(date, '20:00:00')! && needsSession(values, keys, body.force)) {
        sessionNeeds.set(`${ticker}|${date}`, { ticker, date, tradeDate });
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

    const sharesByKey = new Map<string, number | null>();
    const shareResults = await Promise.allSettled([...floatNeeds.values()].map(async ({ ticker, date }) => ({
      key: `${ticker}|${date}`,
      shares: await fetchSharesOutstanding(ticker, date),
    })));
    for (const result of shareResults) {
      if (result.status === 'fulfilled') {
        sharesByKey.set(result.value.key, result.value.shares);
      } else {
        console.warn('Massive shares outstanding request failed', result.reason);
      }
    }

    const minuteBarsByKey = new Map<string, Array<{ t: number; h: number }>>();
    await Promise.all([...sessionNeeds.entries()].map(async ([key, { ticker, date, tradeDate }]) => {
      try {
        const bars = await fetchMassiveAggregateBars({
          ticker,
          multiplier: '1',
          timespan: 'minute',
          from: String(nyDateTimeToEpoch(date, '16:00:00')),
          to: String(nyDateTimeToEpoch(tradeDate, '09:30:00')),
          adjusted: false,
        });
        minuteBarsByKey.set(key, bars.flatMap((bar) => {
          const t = Number(bar.t);
          const h = Number(bar.h);
          return Number.isFinite(t) && Number.isFinite(h) ? [{ t, h }] : [];
        }));
      } catch (error) {
        console.warn(`Massive minute bars unavailable for ${key}`, error);
      }
    }));

    const updatedRows: Array<typeof sheetRows.$inferSelect> = [];
    let missed = Math.max(0, body.rowIds.length - rows.length);

    for (const row of rows) {
      const values = row.values;
      const ticker = normalizeMassiveTicker(textCell(values, 'ticker'));
      const date = textCell(values, 'date');
      const bar = date ? barsByDate.get(date)?.get(ticker) ?? null : null;
      const sharesOutstanding = date ? sharesByKey.get(`${ticker}|${date}`) ?? null : null;
      const minuteBars = minuteBarsByKey.get(`${ticker}|${date}`);
      const tradeDate = minuteBars ? getNextTradingSession(date) : null;
      const sessionHighs = minuteBars && tradeDate
        ? computeSessionHighs(minuteBars, date, tradeDate, nowMs)
        : null;
      const fill = computeRowFill({
        values,
        keys,
        bar,
        sharesOutstanding,
        sessionHighs,
        force: body.force,
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

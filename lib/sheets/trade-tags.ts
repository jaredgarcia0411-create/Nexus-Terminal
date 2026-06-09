import { and, eq, inArray, isNull } from 'drizzle-orm';

import {
  sheetMembers,
  sheetRows,
  sheets,
  tags as tagsTable,
  trades,
  tradeTags as tradeTagsTable,
} from '@/lib/db/schema';
import type { SheetColumn } from '@/lib/sheets/columns';
import type { QueryDb } from '@/lib/server-db-utils';

// key = `${TICKER}|${YYYY-MM-DD}`
export async function buildSheetMatchesForDates(
  db: QueryDb,
  userId: string,
  dates: string[],
): Promise<Map<string, { tags: string[]; reportId?: string }>> {
  const result = new Map<string, { tags: string[]; reportId?: string }>();
  if (dates.length === 0) return result;

  const dateSet = new Set(dates);
  const rows = await db
    .select({ columns: sheets.columns, values: sheetRows.values })
    .from(sheetRows)
    .innerJoin(sheets, eq(sheetRows.sheetId, sheets.id))
    .innerJoin(sheetMembers, eq(sheetMembers.sheetId, sheets.id))
    .where(and(
      eq(sheetMembers.userId, userId),
      inArray(sheetMembers.role, ['owner', 'editor']),
      eq(sheets.isTemplate, false),
      isNull(sheets.archivedAt),
      isNull(sheets.rootId),
    ));

  for (const row of rows) {
    const values = (row.values ?? {}) as Record<string, unknown>;
    const date = String(values.date ?? '');
    const ticker = String(values.ticker ?? '').trim().toUpperCase();
    if (!ticker || !dateSet.has(date)) continue;

    const key = `${ticker}|${date}`;
    const entry = result.get(key) ?? { tags: [] };
    const reportId = typeof values.research_report === 'string' && values.research_report.trim()
      ? values.research_report
      : undefined;
    if (reportId && !entry.reportId) entry.reportId = reportId;

    for (const column of (row.columns ?? []) as SheetColumn[]) {
      if (!column.asTags) continue;

      const cell = values[column.key];
      const cellValues = Array.isArray(cell) ? cell : cell != null ? [cell] : [];
      for (const raw of cellValues) {
        const tag = String(raw).trim();
        if (tag && !entry.tags.includes(tag)) entry.tags.push(tag);
      }
    }

    result.set(key, entry);
  }

  return result;
}

// Self-contained so import and sheet-edit callers only need affected dates.
export async function applySheetTagsForDates(
  db: QueryDb,
  userId: string,
  dates: string[],
): Promise<void> {
  const uniqueDates = Array.from(new Set(dates.filter(Boolean)));
  if (uniqueDates.length === 0) return;

  const matches = await buildSheetMatchesForDates(db, userId, uniqueDates);
  if (matches.size === 0) return;

  const tradeRows = await db
    .select({ id: trades.id, symbol: trades.symbol, sortKey: trades.sortKey })
    .from(trades)
    .where(and(eq(trades.userId, userId), inArray(trades.sortKey, uniqueDates)));

  for (const trade of tradeRows) {
    const entry = matches.get(`${trade.symbol.trim().toUpperCase()}|${trade.sortKey}`);
    if (!entry || entry.tags.length === 0) continue;

    for (const tag of entry.tags) {
      await db.insert(tagsTable).values({ userId, name: tag }).onConflictDoNothing();
      await db.insert(tradeTagsTable).values({ userId, tradeId: trade.id, tag }).onConflictDoNothing();
    }
  }
}

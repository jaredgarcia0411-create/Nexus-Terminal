import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';

import { researchReports } from '@/lib/db/schema';
import type { QueryDb } from '@/lib/server-db-utils';
import { epochToNySortKey } from '@/lib/time-utils';

// key = `${TICKER}|${YYYY-MM-DD}` where the date is the report's NY generation
// date. A report only matches a sheet row dated the same day it was generated.
// This deliberately prevents a fresh report from back-filling an old row for a
// ticker that was re-traded months later. No freshness window: a months-old
// report still resolves for a row of its own date.
export async function resolveReportIdsByTickerAndDate(
  db: QueryDb,
  tickers: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const unique = Array.from(
    new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean)),
  );
  if (unique.length === 0) return result;

  const rows = await db
    .select({
      id: researchReports.id,
      ticker: researchReports.ticker,
      generatedAt: researchReports.generatedAt,
    })
    .from(researchReports)
    .where(and(
      inArray(researchReports.ticker, unique),
      eq(researchReports.status, 'complete'),
      isNotNull(researchReports.reportJson),
    ))
    .orderBy(desc(researchReports.generatedAt));

  for (const row of rows) {
    if (!row.generatedAt) continue;
    const date = epochToNySortKey(row.generatedAt.getTime());
    const key = `${row.ticker.trim().toUpperCase()}|${date}`;
    if (!result.has(key)) result.set(key, row.id);
  }

  return result;
}

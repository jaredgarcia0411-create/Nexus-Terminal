import { and, eq, inArray } from 'drizzle-orm';

import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { tradeTags as tradeTagsTable, trades } from '@/lib/db/schema';
import { dedupeRows } from '@/lib/sample-set-rows';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { sampleSetFromTagsSchema } from '@/lib/validations/sample-sets';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const bodyState = await parseAndValidate(request, sampleSetFromTagsSchema);
    if (bodyState.error) return bodyState.error;
    const { tags } = bodyState.data;

    const rawRows = await db
      .select({ ticker: trades.symbol, date: trades.date })
      .from(trades)
      .innerJoin(
        tradeTagsTable,
        and(eq(tradeTagsTable.userId, trades.userId), eq(tradeTagsTable.tradeId, trades.id)),
      )
      .where(and(eq(trades.userId, authState.user.id), inArray(tradeTagsTable.tag, tags)));

    let skippedBadDate = 0;
    const validRows = rawRows.flatMap((row) => {
      if (!row.ticker || !DATE_REGEX.test(row.date)) {
        skippedBadDate += 1;
        return [];
      }

      return [{ ticker: row.ticker.toUpperCase(), date: row.date }];
    });

    const { rows, skippedCount } = dedupeRows(validRows);

    return Response.json({
      rows,
      skippedCount: skippedCount + skippedBadDate,
    });
  } catch (error) {
    logRouteError('sample-sets.from-tags.post', error);
    return internalServerError();
  }
}

import { and, eq, inArray, like } from 'drizzle-orm';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getPoolDb } from '@/lib/db';
import { tradeImportBatches, trades, tradeTags as tradeTagsTable, tags as tagsTable } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { bulkTradeSchema } from '@/lib/validations/trades';

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getPoolDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const bodyState = await parseAndValidate(request, bulkTradeSchema);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    const uniqueIds = body.action === 'addTags'
      ? Array.from(new Set(body.assignments.map((item) => item.tradeId.trim()).filter(Boolean)))
      : Array.from(new Set(body.ids.map((id) => id.trim()).filter(Boolean)));

    if (uniqueIds.length === 0) {
      return Response.json({ error: 'ids are required' }, { status: 400 });
    }

    if (body.action === 'applyRisk') {
      const risk = Number(body.value);
      if (!Number.isFinite(risk) || risk <= 0) {
        return Response.json({ error: 'value must be a positive number' }, { status: 400 });
      }
    }

    const ownedRows = await db.select({ id: trades.id, sortKey: trades.sortKey })
      .from(trades)
      .where(and(eq(trades.userId, authState.user.id), inArray(trades.id, uniqueIds)));
    const ownedIds = ownedRows.map((row) => row.id);

    if (ownedIds.length === 0) {
      return Response.json({ success: true, action: body.action, ids: [] });
    }

    await db.transaction(async (tx) => {
      if (body.action === 'delete') {
        for (const id of ownedIds) {
          await tx.delete(trades)
            .where(and(eq(trades.id, id), eq(trades.userId, authState.user.id)));
        }

        // Clear import fingerprints for every affected date so the same CSV can
        // be re-uploaded. Single-delete already does this; bulk previously did
        // not, leaving ghost rows that silently blocked re-import. Executions
        // and tags cascade on the trade delete above, so nothing else lingers.
        const sortKeys = Array.from(new Set(ownedRows.map((row) => row.sortKey)));
        for (const sortKey of sortKeys) {
          await tx.delete(tradeImportBatches).where(and(
            eq(tradeImportBatches.userId, authState.user.id),
            like(tradeImportBatches.batchKey, `raw|${sortKey}|%`),
          ));
        }
      }

      if (body.action === 'applyRisk') {
        const risk = Number(body.value);
        for (const id of ownedIds) {
          await tx.update(trades)
            .set({ initialRisk: risk })
            .where(and(eq(trades.id, id), eq(trades.userId, authState.user.id)));
        }
      }

      if (body.action === 'addTag') {
        const tag = body.value;

        await tx.insert(tagsTable)
          .values({ userId: authState.user.id, name: tag })
          .onConflictDoNothing();

        for (const id of ownedIds) {
          await tx.insert(tradeTagsTable)
            .values({ userId: authState.user.id, tradeId: id, tag })
            .onConflictDoNothing();
        }
      }

      if (body.action === 'addTags') {
        const ownedIdSet = new Set(ownedIds);
        for (const assignment of body.assignments) {
          const tradeId = assignment.tradeId.trim();
          if (!ownedIdSet.has(tradeId)) continue;

          const tags = Array.from(new Set(assignment.tags.map((tag) => tag.trim()).filter(Boolean)));
          for (const tag of tags) {
            await tx.insert(tagsTable)
              .values({ userId: authState.user.id, name: tag })
              .onConflictDoNothing();
            await tx.insert(tradeTagsTable)
              .values({ userId: authState.user.id, tradeId, tag })
              .onConflictDoNothing();
          }
        }
      }
    });

    return Response.json({ success: true, action: body.action, ids: ownedIds });
  } catch (error) {
    logRouteError('trades.bulk.post', error);
    return internalServerError();
  }
}

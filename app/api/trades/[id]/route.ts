import { and, asc, eq, like, sql } from 'drizzle-orm';
import { z } from 'zod';
import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { getDb, getPoolDb } from '@/lib/db';
import { tradeExecutions, tradeImportBatches, trades, tradeTags as tradeTagsTable, tags as tagsTable } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser, toTrade } from '@/lib/server-db-utils';
import { epochToNySortKey, parseAbsoluteTimestampMs } from '@/lib/time-utils';
import { closePositionSchema, updateTradeSchema } from '@/lib/validations/trades';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;

    const [trade] = await db.select().from(trades)
      .where(and(eq(trades.id, id), eq(trades.userId, authState.user.id)))
      .limit(1);
    if (!trade) {
      return Response.json({ error: 'Trade not found' }, { status: 404 });
    }

    const [tagRows, executionRows] = await Promise.all([
      db.select({ tag: tradeTagsTable.tag })
        .from(tradeTagsTable)
        .where(and(eq(tradeTagsTable.userId, authState.user.id), eq(tradeTagsTable.tradeId, id))),
      db.select().from(tradeExecutions)
        .where(and(eq(tradeExecutions.userId, authState.user.id), eq(tradeExecutions.tradeId, id)))
        .orderBy(asc(tradeExecutions.time), asc(tradeExecutions.id)),
    ]);

    const tagList = tagRows.map((r) => r.tag);
    const rawExecutions = executionRows.map((row) => ({
      id: row.id,
      side: row.side,
      price: row.price,
      qty: row.qty,
      time: row.time,
      timestamp: row.timestamp ?? undefined,
      commission: row.commission ?? 0,
      fees: row.fees ?? 0,
    }));

    return Response.json({ trade: toTrade(trade, tagList, rawExecutions) });
  } catch (error) {
    logRouteError('trades.id.get', error);
    return internalServerError();
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const isCloseAction =
      rawBody && typeof rawBody === 'object' && (rawBody as Record<string, unknown>)['action'] === 'close';

    if (isCloseAction) {
      const parsed = closePositionSchema.safeParse(rawBody);
      if (!parsed.success) {
        return Response.json(
          { error: 'Validation failed', details: z.flattenError(parsed.error) },
          { status: 400 },
        );
      }
      const { exitPrice, exitTime } = parsed.data;

      const [current] = await db.select().from(trades)
        .where(and(eq(trades.id, id), eq(trades.userId, authState.user.id)))
        .limit(1);

      if (!current) return Response.json({ error: 'Trade not found' }, { status: 404 });
      if (!current.isOpen) return Response.json({ error: 'Trade is already closed' }, { status: 400 });

      const qty = current.totalQuantity;
      const entryPrice = current.avgEntryPrice;
      const commission = current.commission ?? 0;
      const fees = current.fees ?? 0;
      const grossPnl = current.direction === 'LONG'
        ? (exitPrice - entryPrice) * qty
        : (entryPrice - exitPrice) * qty;
      const netPnl = grossPnl - commission - fees;

      await db.update(trades).set({
        avgExitPrice: exitPrice,
        exitTime,
        grossPnl,
        netPnl,
        pnl: netPnl,
        isOpen: false,
        closedAt: sql`now()`,
        remainingQty: 0,
      }).where(and(eq(trades.id, id), eq(trades.userId, authState.user.id)));

      const [updated] = await db.select().from(trades)
        .where(and(eq(trades.id, id), eq(trades.userId, authState.user.id)))
        .limit(1);
      if (!updated) return Response.json({ error: 'Trade not found after update' }, { status: 404 });

      const [tagRows, executionRows] = await Promise.all([
        db.select({ tag: tradeTagsTable.tag })
          .from(tradeTagsTable)
          .where(and(eq(tradeTagsTable.userId, authState.user.id), eq(tradeTagsTable.tradeId, id))),
        db.select().from(tradeExecutions)
          .where(and(eq(tradeExecutions.userId, authState.user.id), eq(tradeExecutions.tradeId, id)))
          .orderBy(asc(tradeExecutions.time), asc(tradeExecutions.id)),
      ]);
      const tagList = tagRows.map((row) => row.tag);
      const rawExecutions = executionRows.map((row) => ({
        id: row.id,
        side: row.side,
        price: row.price,
        qty: row.qty,
        time: row.time,
        timestamp: row.timestamp ?? undefined,
        commission: row.commission ?? 0,
        fees: row.fees ?? 0,
      }));

      return Response.json({ trade: toTrade(updated, tagList, rawExecutions) });
    }

    const parseResult = updateTradeSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return Response.json(
        { error: 'Validation failed', details: z.flattenError(parseResult.error) },
        { status: 400 },
      );
    }
    const body = parseResult.data;

    const updateData: Partial<typeof trades.$inferInsert> = {};

    if (Object.prototype.hasOwnProperty.call(body, 'notes')) {
      updateData.notes = body.notes?.trim() || null;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'initialRisk')) {
      updateData.initialRisk = body.initialRisk ?? null;
    }

    if (Object.keys(updateData).length > 0) {
      await db.update(trades)
        .set(updateData)
        .where(and(eq(trades.id, id), eq(trades.userId, authState.user.id)));
    }

    if (Array.isArray(body.tags)) {
      await db.delete(tradeTagsTable).where(and(
        eq(tradeTagsTable.userId, authState.user.id),
        eq(tradeTagsTable.tradeId, id),
      ));
      for (const tag of body.tags) {
        await db.insert(tradeTagsTable).values({
          userId: authState.user.id,
          tradeId: id,
          tag,
        }).onConflictDoNothing();
        await db.insert(tagsTable).values({ userId: authState.user.id, name: tag }).onConflictDoNothing();
      }
    }

    const [trade] = await db.select().from(trades)
      .where(and(eq(trades.id, id), eq(trades.userId, authState.user.id)))
      .limit(1);
    if (!trade) {
      return Response.json({ error: 'Trade not found' }, { status: 404 });
    }

    const [tagRows, executionRows] = await Promise.all([
      db.select({ tag: tradeTagsTable.tag })
        .from(tradeTagsTable)
        .where(and(eq(tradeTagsTable.userId, authState.user.id), eq(tradeTagsTable.tradeId, id))),
      db.select().from(tradeExecutions)
        .where(and(eq(tradeExecutions.userId, authState.user.id), eq(tradeExecutions.tradeId, id)))
        .orderBy(asc(tradeExecutions.time), asc(tradeExecutions.id)),
    ]);
    const tagList = tagRows.map((r) => r.tag);
    const rawExecutions = executionRows.map((row) => ({
      id: row.id,
      side: row.side,
      price: row.price,
      qty: row.qty,
      time: row.time,
      timestamp: row.timestamp ?? undefined,
      commission: row.commission ?? 0,
      fees: row.fees ?? 0,
    }));

    return Response.json({ trade: toTrade(trade, tagList, rawExecutions) });
  } catch (error) {
    logRouteError('trades.id.patch', error);
    return internalServerError();
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    // getPoolDb() is required because we use db.transaction().
    // getDb() uses the HTTP transport (NeonHttpDatabase) which does not
    // support transactions; getPoolDb() uses the WebSocket pool (NeonDatabase),
    // the same client used by import-raw/route.ts.
    const db = getPoolDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;

    // Read sortKey before deleting so we can clear dedup rows.
    const [row] = await db.select({ sortKey: trades.sortKey })
      .from(trades)
      .where(and(eq(trades.id, id), eq(trades.userId, authState.user.id)))
      .limit(1);

    const importDaysToClear = new Set<string>();
    if (row?.sortKey) importDaysToClear.add(row.sortKey);

    const execRows = await db.select({ timestamp: tradeExecutions.timestamp })
      .from(tradeExecutions)
      .where(and(
        eq(tradeExecutions.userId, authState.user.id),
        eq(tradeExecutions.tradeId, id),
      ));

    for (const exec of execRows) {
      const ms = parseAbsoluteTimestampMs(exec.timestamp);
      if (ms != null) importDaysToClear.add(epochToNySortKey(ms));
    }

    await db.transaction(async (tx) => {
      // Clear matching tradeImportBatches rows so the user can re-upload
      // the same CSV after deleting this trade. The raw| prefix scopes
      // the like() to CSV-import batches only, protecting against future
      // batch-key formats that might share the same date string.
      for (const day of importDaysToClear) {
        await tx.delete(tradeImportBatches).where(
          and(
            eq(tradeImportBatches.userId, authState.user.id),
            like(tradeImportBatches.batchKey, `raw|${day}|%`),
          ),
        );
      }

      await tx.delete(trades).where(
        and(eq(trades.id, id), eq(trades.userId, authState.user.id)),
      );
    });

    return Response.json({ success: true, id });
  } catch (error) {
    logRouteError('trades.id.delete', error);
    return internalServerError();
  }
}

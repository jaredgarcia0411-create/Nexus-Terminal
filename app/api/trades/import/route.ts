import { and, desc, eq } from 'drizzle-orm';
import { logRouteError, parseJsonBody } from '@/lib/api-route-utils';
import { getPoolDb } from '@/lib/db';
import {
  tradeExecutions,
  tradeImportBatches,
  trades,
  tradeTags as tradeTagsTable,
  tags as tagsTable,
} from '@/lib/db/schema';
import {
  dbUnavailable,
  ensureUser,
  loadTagsForTradeIds,
  requireUser,
  toExecutionRowId,
  toTrade,
  type ApiTrade,
} from '@/lib/server-db-utils';

type ImportPayload = {
  trades: ApiTrade[];
  batchKey?: string;
};

type NormalizedRawExecution = {
  id: string;
  side: 'ENTRY' | 'EXIT';
  price: number;
  qty: number;
  time: string;
  timestamp: string | null;
  commission: number;
  fees: number;
};

type ImportFailureContext = {
  tradeIndex?: number;
  tradeId?: string;
};

type ImportFailureCause = {
  importContext?: ImportFailureContext;
};

type NormalizedTradeInput = {
  trade: ApiTrade;
  rawExecutions: NormalizedRawExecution[];
  tags: string[];
};

function withImportContext(error: unknown, context: ImportFailureContext) {
  const wrapped = error instanceof Error ? error : new Error(String(error));
  (wrapped as Error & ImportFailureCause).cause = error;
  (wrapped as Error & ImportFailureCause).importContext = context;
  return wrapped;
}

function getImportContext(error: unknown): ImportFailureContext | undefined {
  const typed = error as ImportFailureCause & { cause?: unknown };
  if (typed.importContext && typeof typed.importContext === 'object') {
    return typed.importContext;
  }

  const cause = typed.cause;
  if (cause && typeof cause === 'object') {
    const typedCause = cause as ImportFailureCause;
    if (typedCause.importContext && typeof typedCause.importContext === 'object') {
      return typedCause.importContext;
    }
  }

  return undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function toTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeStringArray(values: unknown, label: string, index: number): string[] | string {
  if (values === undefined) return [];
  if (!Array.isArray(values)) {
    return `${label} at trades[${index}] must be an array`;
  }

  const normalized = [] as string[];
  for (const item of values) {
    const value = toTrimmedString(item);
    if (!value) {
      return `${label} at trades[${index}] must contain non-empty strings`;
    }
    normalized.push(value);
  }

  return Array.from(new Set(normalized));
}

function validateTradePayload(trade: Partial<ApiTrade>, index: number): string | null {
  if (!toTrimmedString(trade.id) || !toTrimmedString(trade.date) || !toTrimmedString(trade.sortKey) || !toTrimmedString(trade.symbol)) {
    return `trades[${index}] is missing required string fields`;
  }

  if (!toTrimmedString(trade.direction) || (trade.direction !== 'LONG' && trade.direction !== 'SHORT')) {
    return `trades[${index}] has invalid direction`;
  }

  if (!isFiniteNumber(trade.avgEntryPrice) || !isFiniteNumber(trade.avgExitPrice) || !isFiniteNumber(trade.totalQuantity)) {
    return `trades[${index}] has invalid numeric fields`;
  }

  const netPnl = trade.netPnl ?? trade.pnl;
  if (!isFiniteNumber(netPnl)) {
    return `trades[${index}] must include netPnl or pnl`;
  }

  if (trade.rawExecutions !== undefined && !Array.isArray(trade.rawExecutions)) {
    return `trades[${index}].rawExecutions must be an array`;
  }

  if (trade.tags !== undefined && !Array.isArray(trade.tags)) {
    return `trades[${index}].tags must be an array`;
  }

  if (trade.notes !== undefined && typeof trade.notes !== 'string') {
    return `trades[${index}].notes must be a string`;
  }

  return null;
}

function normalizeExecutionList(
  userId: string,
  tradeId: string,
  tradeIndex: number,
  executions: ApiTrade['rawExecutions'] = [],
): { data: NormalizedRawExecution[]; error: string | null } {
  const seenIds = new Set<string>();
  const normalized = [] as NormalizedRawExecution[];

  for (let index = 0; index < executions.length; index += 1) {
    const execution = executions[index] as unknown as Partial<NormalizedRawExecution & { timestamp?: unknown }>;

    if (!execution || typeof execution !== 'object') {
      return { data: [], error: `trades[${tradeIndex}].rawExecutions[${index}] must be an object` };
    }

    const side = execution.side;
    if (side !== 'ENTRY' && side !== 'EXIT') {
      return { data: [], error: `trades[${tradeIndex}].rawExecutions[${index}].side must be ENTRY or EXIT` };
    }

    if (!isFiniteNumber(execution.price) || !isFiniteNumber(execution.qty) || execution.qty <= 0) {
      return { data: [], error: `trades[${tradeIndex}].rawExecutions[${index}] must include positive finite price and qty` };
    }

    const time = toTrimmedString(execution.time);
    if (!time) {
      return { data: [], error: `trades[${tradeIndex}].rawExecutions[${index}].time must be a non-empty string` };
    }

    if (!isFiniteNumber(execution.commission)) {
      execution.commission = 0;
    }
    if (!isFiniteNumber(execution.fees)) {
      execution.fees = 0;
    }

    let executionId = toExecutionRowId(userId, tradeId, execution.id, index);
    while (seenIds.has(executionId)) {
      executionId = `${executionId}-dup`;
    }
    seenIds.add(executionId);

    normalized.push({
      id: executionId,
      side,
      price: execution.price,
      qty: execution.qty,
      time,
      timestamp: normalizeTimestamp(execution.timestamp),
      commission: execution.commission ?? 0,
      fees: execution.fees ?? 0,
    });
  }

  return { data: normalized, error: null };
}

function getPostgresErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object') {
    const typed = error as { code?: unknown };
    if (typeof typed.code === 'string') {
      return typed.code;
    }
  }

  return undefined;
}

function getPostgresErrorConstraint(error: unknown): string | undefined {
  if (error && typeof error === 'object') {
    const typed = error as { constraint?: unknown };
    if (typeof typed.constraint === 'string') {
      return typed.constraint;
    }
  }

  return undefined;
}

function importFailure(error: unknown) {
  const importContext = getImportContext(error);
  const cause = error instanceof Error && (error as { cause?: unknown }).cause;
  const causeLike = cause && typeof cause === 'object' ? cause : error;
  const code = getPostgresErrorCode(causeLike) ?? getPostgresErrorCode(error);
  const constraint = getPostgresErrorConstraint(causeLike) ?? getPostgresErrorConstraint(error);

  const status =
    code === '23505' || code === '23514'
      ? 409
      : code === '23502' || code === '23503' || code === '22P02'
        ? 400
        : 500;

  if (!(error instanceof Error)) {
    return Response.json({ error: 'Import failed while saving trades', details: 'Unknown error' }, { status: 500 });
  }

  const message = (cause instanceof Error ? cause.message : error.message) || 'Unknown error';
  return Response.json({
    error: 'Import failed while saving trades',
    details: message,
    ...(code ? { code } : {}),
    ...(constraint ? { constraint } : {}),
    ...(importContext ? { tradeIndex: importContext.tradeIndex, tradeId: importContext.tradeId } : {}),
  }, { status });
}

function normalizeTimestamp(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.trim()) return value;
  return null;
}

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getPoolDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const bodyState = await parseJsonBody<ImportPayload>(request);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    if (!Array.isArray(body.trades)) {
      return Response.json({ error: 'trades must be an array' }, { status: 400 });
    }

    const normalizedTrades = body.trades.map((rawTrade, tradeIndex) => {
      const trade = rawTrade as Partial<ApiTrade>;

      const validationError = validateTradePayload(trade, tradeIndex);
      if (validationError) {
        throw Response.json({ error: validationError }, { status: 400 });
      }

      const tradeId = trade.id as string;

      const tags = normalizeStringArray(trade.tags, 'trades.tags', tradeIndex);
      if (typeof tags === 'string') {
        throw Response.json({ error: tags }, { status: 400 });
      }

      const rawExecutions = normalizeExecutionList(authState.user.id, tradeId, tradeIndex, trade.rawExecutions);
      if (rawExecutions.error) {
        throw Response.json({ error: rawExecutions.error }, { status: 400 });
      }

      return {
        trade: trade as ApiTrade,
        tradeId,
        rawExecutions: rawExecutions.data,
        tags,
      };
    });

    const batchKey = typeof body.batchKey === 'string' ? body.batchKey.trim() : '';
    if (batchKey.length > 256) {
      return Response.json({ error: 'batchKey must be 256 characters or fewer' }, { status: 400 });
    }

    let importSkipped = false;

    await db.transaction(async (tx) => {
      if (batchKey) {
        const inserted = await tx.insert(tradeImportBatches)
          .values({ userId: authState.user.id, batchKey })
          .onConflictDoNothing()
          .returning({ batchKey: tradeImportBatches.batchKey });

        if (inserted.length === 0) {
          importSkipped = true;
          return;
        }
      }

      for (let tradeIndex = 0; tradeIndex < normalizedTrades.length; tradeIndex += 1) {
        const normalizedTrade = normalizedTrades[tradeIndex];
        const trade = normalizedTrade.trade;

        try {
          const commission = trade.commission ?? 0;
          const fees = trade.fees ?? 0;
          const netPnl = trade.netPnl ?? trade.pnl ?? 0;
          const grossPnl = trade.grossPnl ?? netPnl + commission + fees;
          const legacyExecutionCount = (trade as unknown as Record<string, unknown>)['executions'];
          const executionCount = trade.executionCount ?? (typeof legacyExecutionCount === 'number' ? legacyExecutionCount : 1);

          const executionRows = normalizedTrade.rawExecutions;

          await tx.insert(trades).values({
            id: trade.id,
            userId: authState.user.id,
            date: trade.date,
            sortKey: trade.sortKey,
            symbol: trade.symbol,
            direction: trade.direction,
            avgEntryPrice: trade.avgEntryPrice,
            avgExitPrice: trade.avgExitPrice,
            totalQuantity: trade.totalQuantity,
            grossPnl,
            netPnl,
            entryTime: trade.entryTime ?? '',
            exitTime: trade.exitTime ?? '',
            executionCount,
            mfe: trade.mfe ?? null,
            mae: trade.mae ?? null,
            bestExitPnl: trade.bestExitPnl ?? null,
            exitEfficiency: trade.exitEfficiency ?? null,
            pnl: netPnl,
            executions: executionCount,
            initialRisk: trade.initialRisk ?? null,
            commission,
            fees,
            notes: trade.notes ?? null,
          }).onConflictDoUpdate({
            target: [trades.userId, trades.id],
            set: {
              avgEntryPrice: trade.avgEntryPrice,
              avgExitPrice: trade.avgExitPrice,
              totalQuantity: trade.totalQuantity,
              grossPnl,
              netPnl,
              entryTime: trade.entryTime ?? '',
              exitTime: trade.exitTime ?? '',
              executionCount,
              mfe: trade.mfe ?? null,
              mae: trade.mae ?? null,
              bestExitPnl: trade.bestExitPnl ?? null,
              exitEfficiency: trade.exitEfficiency ?? null,
              pnl: netPnl,
              executions: executionCount,
              commission,
              fees,
            },
          });

          if (Array.isArray(executionRows) && executionRows.length > 0) {
            await tx.delete(tradeExecutions).where(and(
              eq(tradeExecutions.userId, authState.user.id),
              eq(tradeExecutions.tradeId, trade.id),
            ));

            await tx.insert(tradeExecutions).values(
              executionRows.map((execution) => ({
                id: execution.id,
                userId: authState.user.id,
                tradeId: trade.id,
                side: execution.side,
                price: execution.price,
                qty: execution.qty,
                time: execution.time,
                timestamp: execution.timestamp,
                commission: execution.commission,
                fees: execution.fees,
              })),
            );
          }

          if (normalizedTrade.tags.length > 0) {
            for (const tag of normalizedTrade.tags) {
              await tx.insert(tagsTable).values({ userId: authState.user.id, name: tag }).onConflictDoNothing();
              await tx.insert(tradeTagsTable).values({
                userId: authState.user.id,
                tradeId: trade.id,
                tag,
              }).onConflictDoNothing();
            }
          }
        } catch (error) {
          throw withImportContext(error, { tradeIndex, tradeId: trade.id });
        }
      }
    });

    const tradeRows = await db.select().from(trades)
      .where(eq(trades.userId, authState.user.id))
      .orderBy(desc(trades.date));
    const tradeIds = tradeRows.map((row) => row.id);
    const tagMap = await loadTagsForTradeIds(db, authState.user.id, tradeIds);

    const tradeList = tradeRows.map((row) => toTrade(row, tagMap.get(row.id) ?? []));
    return Response.json({ trades: tradeList, importSkipped });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    logRouteError('trades.import.post', error);
    return importFailure(error);
  }
}

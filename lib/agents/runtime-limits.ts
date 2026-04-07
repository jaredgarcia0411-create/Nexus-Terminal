import { and, eq, gte, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { agentRegistry, agentRequestLog } from '@/lib/db/schema';
import type { AgentDb } from './db';
import { getLlmBudgetConfig } from './llm-client';
import {
  BudgetExceededError,
  CircuitOpenError,
  RateLimitExceededError,
} from './types';
import type { AgentId, CircuitBreakerState, TokenTrackingEntry } from './types';

type SelectQuery<Row> = {
  where(condition: unknown): {
    limit(count: number): Promise<Row[]>;
  };
};

type SelectBuilder = {
  from(table: unknown): SelectQuery<Record<string, unknown>>;
};

type DbLike = AgentDb & {
  select<TSelected extends Record<string, unknown>>(
    selected?: TSelected,
  ): SelectBuilder;
};

function createBudgetExceededError(agentId: AgentId, limitType: 'daily' | 'monthly') {
  const error = new BudgetExceededError(agentId, limitType);
  error.name = 'BudgetExceededError';
  return error;
}

function startOfCurrentUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function startOfCurrentUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function oneHourAgo(now: Date): Date {
  return new Date(now.getTime() - 60 * 60 * 1000);
}

function readAggregateNumber(row: Record<string, unknown> | undefined, key: string): number {
  return Number(row?.[key] ?? 0);
}

function normalizeCircuitBreakerState(config: unknown): CircuitBreakerState {
  if (!config || typeof config !== 'object') {
    return { consecutiveFailures: 0, openedAt: null };
  }

  const breaker = (config as { circuitBreaker?: unknown }).circuitBreaker;
  if (!breaker || typeof breaker !== 'object') {
    return { consecutiveFailures: 0, openedAt: null };
  }

  const rawFailures = (breaker as { consecutiveFailures?: unknown }).consecutiveFailures;
  const rawOpenedAt = (breaker as { openedAt?: unknown }).openedAt;

  return {
    consecutiveFailures: Number.isFinite(Number(rawFailures)) ? Math.max(0, Math.floor(Number(rawFailures))) : 0,
    openedAt: typeof rawOpenedAt === 'string' && rawOpenedAt.trim() ? rawOpenedAt : null,
  };
}

async function loadUserCost(db: DbLike, userId: string, since: Date): Promise<number> {
  const rows = await db.select({
    totalCostCents: sql<number>`coalesce(sum(${agentRequestLog.estimatedCostCents}), 0)`,
  }).from(agentRequestLog).where(and(eq(agentRequestLog.userId, userId), gte(agentRequestLog.createdAt, since))).limit(1);

  return readAggregateNumber(rows[0], 'totalCostCents');
}

async function loadUserRequestCount(db: DbLike, userId: string, since: Date): Promise<number> {
  const rows = await db.select({
    requestCount: sql<number>`coalesce(count(*), 0)`,
  }).from(agentRequestLog).where(and(eq(agentRequestLog.userId, userId), gte(agentRequestLog.createdAt, since))).limit(1);

  return readAggregateNumber(rows[0], 'requestCount');
}

async function loadAgentRegistryConfig(db: DbLike, agentId: AgentId): Promise<unknown> {
  const rows = await db.select({
    config: agentRegistry.config,
  }).from(agentRegistry).where(eq(agentRegistry.id, agentId)).limit(1);

  return rows[0]?.config ?? null;
}

export async function checkBudget(db: AgentDb, userId: string, agentId: AgentId): Promise<void> {
  const now = new Date();
  const budget = getLlmBudgetConfig();

  const dailyCost = await loadUserCost(db as DbLike, userId, startOfCurrentUtcDay(now));
  if (dailyCost >= budget.dailyBudgetCents) {
    throw createBudgetExceededError(agentId, 'daily');
  }

  const monthlyCost = await loadUserCost(db as DbLike, userId, startOfCurrentUtcMonth(now));
  if (monthlyCost >= budget.monthlyBudgetCents) {
    throw createBudgetExceededError(agentId, 'monthly');
  }
}

export async function checkRateLimit(db: AgentDb, userId: string, agentId: AgentId): Promise<void> {
  const count = await loadUserRequestCount(db as DbLike, userId, oneHourAgo(new Date()));
  if (count >= 30) {
    throw new RateLimitExceededError(agentId, userId);
  }
}

export async function recordBreakerFailure(db: AgentDb, agentId: AgentId): Promise<void> {
  await db.execute(sql`
    UPDATE agent_registry
    SET config = jsonb_set(
      jsonb_set(
        config,
        '{circuitBreaker,consecutiveFailures}',
        to_jsonb(COALESCE((config #>> '{circuitBreaker,consecutiveFailures}')::int, 0) + 1)
      ),
      '{circuitBreaker,openedAt}',
      CASE
        WHEN COALESCE((config #>> '{circuitBreaker,consecutiveFailures}')::int, 0) + 1 >= 5
          THEN to_jsonb(now()::text)
        ELSE config #> '{circuitBreaker,openedAt}'
      END
    )
    WHERE id = ${agentId};
  `);
}

export async function recordBreakerSuccess(db: AgentDb, agentId: AgentId): Promise<void> {
  await db.execute(sql`
    UPDATE agent_registry
    SET config = jsonb_set(
      config,
      '{circuitBreaker}',
      ${JSON.stringify({ consecutiveFailures: 0, openedAt: null })}::jsonb,
      true
    )
    WHERE id = ${agentId};
  `);
}

export async function checkCircuitBreaker(db: AgentDb, userId: string, agentId: AgentId): Promise<void> {
  void userId;
  const config = await loadAgentRegistryConfig(db as DbLike, agentId);
  const state = normalizeCircuitBreakerState(config);

  if (state.openedAt === null) {
    return;
  }

  const openedAtMs = Date.parse(state.openedAt);
  if (!Number.isFinite(openedAtMs)) {
    return;
  }

  const elapsedMs = Date.now() - openedAtMs;
  if (elapsedMs < 60_000) {
    throw new CircuitOpenError(agentId, state.openedAt);
  }

  await recordBreakerSuccess(db, agentId);
}

export async function recordLlmAttempt(db: AgentDb, entry: TokenTrackingEntry): Promise<void> {
  await db.insert(agentRequestLog).values({
    id: randomUUID(),
    userId: entry.userId,
    agentId: entry.agentId,
    mode: entry.mode,
    lane: entry.lane,
    modelUsed: entry.modelUsed,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    totalTokens: entry.totalTokens,
    estimatedCostCents: Math.round(entry.estimatedCostCents),
    durationMs: entry.durationMs,
    success: entry.success ? 1 : 0,
    sourceCount: 0,
    chunkCount: 0,
  });

  if (entry.success) {
    await recordBreakerSuccess(db, entry.agentId);
    return;
  }

  await recordBreakerFailure(db, entry.agentId);
}

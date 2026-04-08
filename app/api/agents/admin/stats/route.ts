import { and, desc, eq, gte } from 'drizzle-orm';
import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { getLlmBudgetConfig } from '@/lib/agents/llm-client';
import { requireAgentAdmin } from '@/lib/agents/admin';
import { getAgentDb } from '@/lib/agents/db';
import type { AdminStatsResponse } from '@/lib/agents/types';
import {
  agentJobs,
  agentMemoryV2,
  agentRegistry,
  agentReports,
  agentRequestLog,
} from '@/lib/db/schema';
import { dbUnavailable } from '@/lib/server-db-utils';

function startOfCurrentUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function startOfCurrentUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function asNumber(value: unknown): number {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function average(total: number, count: number): number {
  return count > 0 ? total / count : 0;
}

function sumBy<T>(rows: T[], selector: (row: T) => number): number {
  return rows.reduce((total, row) => total + selector(row), 0);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function getCircuitStatus(openedAt: string | null, now: Date): 'closed' | 'open' | 'half-open' {
  if (!openedAt) {
    return 'closed';
  }

  const openedAtMs = Date.parse(openedAt);
  if (!Number.isFinite(openedAtMs)) {
    return 'closed';
  }

  return now.getTime() - openedAtMs < 60_000 ? 'open' : 'half-open';
}

function isContractFailed(stepLog: unknown): boolean {
  if (!Array.isArray(stepLog) || stepLog.length === 0) {
    return false;
  }

  const lastEntry = stepLog[stepLog.length - 1];
  if (!lastEntry || typeof lastEntry !== 'object') {
    return false;
  }

  return (lastEntry as { errorClass?: unknown }).errorClass === 'contract';
}

function toIsoString(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

export async function GET(request: Request) {
  void request;

  try {
    const authError = requireAgentAdmin(request);
    if (authError) return authError;

    const db = getAgentDb();
    if (!db) return dbUnavailable();

    const now = new Date();
    const dayStart = startOfCurrentUtcDay(now);
    const monthStart = startOfCurrentUtcMonth(now);
    const budget = getLlmBudgetConfig();

    const [
      registryRows,
      todayRequestRows,
      monthRequestRows,
      todayJobRows,
      todayReportRows,
      memoryRows,
      macroRows,
      queuedRows,
      processingRows,
    ] = await Promise.all([
      db.select({
        id: agentRegistry.id,
        displayName: agentRegistry.displayName,
        status: agentRegistry.status,
        lastHeartbeat: agentRegistry.lastHeartbeat,
        config: agentRegistry.config,
      }).from(agentRegistry),
      db.select({
        agentId: agentRequestLog.agentId,
        lane: agentRequestLog.lane,
        totalTokens: agentRequestLog.totalTokens,
        estimatedCostCents: agentRequestLog.estimatedCostCents,
        durationMs: agentRequestLog.durationMs,
        success: agentRequestLog.success,
      }).from(agentRequestLog).where(gte(agentRequestLog.createdAt, dayStart)),
      db.select({
        agentId: agentRequestLog.agentId,
        lane: agentRequestLog.lane,
        totalTokens: agentRequestLog.totalTokens,
        estimatedCostCents: agentRequestLog.estimatedCostCents,
        durationMs: agentRequestLog.durationMs,
        success: agentRequestLog.success,
      }).from(agentRequestLog).where(gte(agentRequestLog.createdAt, monthStart)),
      db.select({
        attempt: agentJobs.attempt,
        stepLog: agentJobs.stepLog,
      }).from(agentJobs).where(gte(agentJobs.createdAt, dayStart)),
      db.select({
        status: agentReports.status,
      }).from(agentReports).where(gte(agentReports.createdAt, dayStart)),
      db.select({
        category: agentMemoryV2.category,
      }).from(agentMemoryV2),
      db.select({
        createdAt: agentReports.createdAt,
      }).from(agentReports)
        .where(and(
          eq(agentReports.userId, 'system-agent-user'),
          eq(agentReports.agentId, 'orchestrator'),
          eq(agentReports.reportType, 'macro-summary'),
          eq(agentReports.status, 'published'),
        ))
        .orderBy(desc(agentReports.createdAt))
        .limit(1),
      db.select({
        createdAt: agentJobs.createdAt,
        nextRetryAt: agentJobs.nextRetryAt,
      }).from(agentJobs).where(eq(agentJobs.status, 'queued')),
      db.select({
        lockExpiresAt: agentJobs.lockExpiresAt,
        lastHeartbeatAt: agentJobs.lastHeartbeatAt,
      }).from(agentJobs).where(eq(agentJobs.status, 'processing')),
    ]);

    const todayRequests = todayRequestRows.length;
    const todaySuccesses = sumBy(todayRequestRows, (row) => asNumber(row.success));
    const todayDurationMs = sumBy(todayRequestRows, (row) => asNumber(row.durationMs));
    const todayTokens = sumBy(todayRequestRows, (row) => asNumber(row.totalTokens));
    const todayEstimatedCostCents = sumBy(todayRequestRows, (row) => asNumber(row.estimatedCostCents));

    const monthTokens = sumBy(monthRequestRows, (row) => asNumber(row.totalTokens));
    const monthEstimatedCostCents = sumBy(monthRequestRows, (row) => asNumber(row.estimatedCostCents));

    const todayByLane = todayRequestRows.reduce<Record<string, {
      totalRequests: number;
      totalTokens: number;
      estimatedCostCents: number;
      successRate: number;
      avgDurationMs: number;
    }>>((acc, row) => {
      const key = row.lane ?? 'unknown';
      const bucket = acc[key] ?? {
        totalRequests: 0,
        totalTokens: 0,
        estimatedCostCents: 0,
        successRate: 0,
        avgDurationMs: 0,
      };

      bucket.totalRequests += 1;
      bucket.totalTokens += asNumber(row.totalTokens);
      bucket.estimatedCostCents += asNumber(row.estimatedCostCents);
      bucket.successRate += asNumber(row.success);
      bucket.avgDurationMs += asNumber(row.durationMs);
      acc[key] = bucket;
      return acc;
    }, {});

    const todayByAgent = todayRequestRows.reduce<Record<string, {
      totalRequests: number;
      totalTokens: number;
      estimatedCostCents: number;
      successRate: number;
      avgDurationMs: number;
    }>>((acc, row) => {
      const key = row.agentId ?? 'unknown';
      const bucket = acc[key] ?? {
        totalRequests: 0,
        totalTokens: 0,
        estimatedCostCents: 0,
        successRate: 0,
        avgDurationMs: 0,
      };

      bucket.totalRequests += 1;
      bucket.totalTokens += asNumber(row.totalTokens);
      bucket.estimatedCostCents += asNumber(row.estimatedCostCents);
      bucket.successRate += asNumber(row.success);
      bucket.avgDurationMs += asNumber(row.durationMs);
      acc[key] = bucket;
      return acc;
    }, {});

    for (const bucket of Object.values(todayByLane)) {
      bucket.successRate = average(bucket.successRate, bucket.totalRequests);
      bucket.avgDurationMs = average(bucket.avgDurationMs, bucket.totalRequests);
    }

    for (const bucket of Object.values(todayByAgent)) {
      bucket.successRate = average(bucket.successRate, bucket.totalRequests);
      bucket.avgDurationMs = average(bucket.avgDurationMs, bucket.totalRequests);
    }

    const contractFailedJobs = todayJobRows.filter((row) => isContractFailed(row.stepLog)).length;
    const retryJobs = todayJobRows.filter((row) => asNumber(row.attempt) > 1).length;
    const todayValidationFailureRate = average(contractFailedJobs, todayJobRows.length);
    const todayRetryRate = average(retryJobs, todayJobRows.length);

    const deliveryPublishedToday = todayReportRows.filter((row) => row.status === 'published').length;
    const deliveryFailures = todayReportRows.filter((row) => row.status === 'delivery_failed').length;
    const deliveryFailureRate = average(deliveryFailures, deliveryPublishedToday + deliveryFailures);

    const memoryByCategory = memoryRows.reduce<Record<string, number>>((acc, row) => {
      const key = row.category ?? 'unknown';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

    const eligibleQueuedRows = queuedRows.filter(
      (row): row is typeof row & { createdAt: Date } =>
        row.createdAt instanceof Date && (!row.nextRetryAt || row.nextRetryAt <= now),
    );
    const oldestQueuedJobAgeSeconds = eligibleQueuedRows.length > 0
      ? Math.max(
        0,
        Math.floor(
          (now.getTime() - Math.min(...eligibleQueuedRows.map((row) => row.createdAt.getTime()))) / 1000,
        ),
      )
      : null;

    const stuckProcessing = processingRows.filter((row) => (
      (row.lockExpiresAt instanceof Date && row.lockExpiresAt < now)
      || (row.lastHeartbeatAt instanceof Date && row.lastHeartbeatAt < new Date(now.getTime() - 10 * 60 * 1000))
      )).length;

    const latestMacroSummary = macroRows[0]?.createdAt ?? null;

    const response: AdminStatsResponse = {
      circuitBreakers: Object.fromEntries(
        registryRows.map((row) => {
          const config = row.config && typeof row.config === 'object'
            ? row.config as { circuitBreaker?: { consecutiveFailures?: unknown; openedAt?: unknown } }
            : {};
          const breaker = config.circuitBreaker ?? {};
          const consecutiveFailures = Math.max(0, Math.floor(asNumber(breaker.consecutiveFailures)));
          const openedAt = readString(breaker.openedAt);

          return [row.id, {
            status: getCircuitStatus(openedAt, now),
            consecutiveFailures,
            lastFailureAt: openedAt,
          }];
        }),
      ),
      today: {
        totalRequests: todayRequests,
        totalTokens: todayTokens,
        estimatedCostCents: todayEstimatedCostCents,
        successRate: average(todaySuccesses, todayRequests),
        avgDurationMs: average(todayDurationMs, todayRequests),
        validationFailureRate: todayValidationFailureRate,
        retryRate: todayRetryRate,
        byLane: todayByLane,
        byAgent: todayByAgent,
      },
      thisMonth: {
        totalTokens: monthTokens,
        estimatedCostCents: monthEstimatedCostCents,
        budgetCents: budget.monthlyBudgetCents,
        budgetUsedPercent: budget.monthlyBudgetCents > 0
          ? (monthEstimatedCostCents / budget.monthlyBudgetCents) * 100
          : 0,
      },
      agents: registryRows.map((row) => ({
        id: row.id,
        displayName: row.displayName,
        status: row.status,
        lastHeartbeat: toIsoString(row.lastHeartbeat),
      })),
      delivery: {
        publishedToday: deliveryPublishedToday,
        deliveryFailures,
        deliveryFailureRate,
      },
      memory: {
        total: memoryRows.length,
        byCategory: memoryByCategory,
      },
      macroSummaries: {
        latestGeneratedAt: latestMacroSummary ? latestMacroSummary.toISOString() : null,
      },
      queue: {
        depth: eligibleQueuedRows.length,
        oldestQueuedJobAgeSeconds,
        stuckProcessing,
      },
    };

    return Response.json(response);
  } catch (error) {
    logRouteError('agents.admin.stats.get', error);
    return internalServerError();
  }
}

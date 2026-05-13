import { eq } from 'drizzle-orm';

import { getDb } from '@/lib/db';
import { askedgarDailyTickers, askedgarRuntimeState } from '@/lib/db/schema';

const DEFAULT_DAILY_LIMIT = 50;
const uniqueTickersToday = new Set<string>();
let resetDate = '';

// Rate limit tracking — when AskEdgar returns 429, we stop making requests
// until the retry window expires. This prevents wasting calls.
let rateLimitedUntil = 0; // Unix timestamp (ms) when we can resume

const MODULE_RATE_LIMIT_REFRESH_MS = 5000;
let rateLimitDbLastSyncedAt = 0;

export async function syncRateLimitFromDb(): Promise<void> {
  if (Date.now() - rateLimitDbLastSyncedAt < MODULE_RATE_LIMIT_REFRESH_MS) return;
  const db = getDb();
  if (!db) return;

  try {
    const [row] = await db
      .select({ rateLimitedUntil: askedgarRuntimeState.rateLimitedUntil })
      .from(askedgarRuntimeState)
      .where(eq(askedgarRuntimeState.id, 'global'))
      .limit(1);

    rateLimitedUntil = row?.rateLimitedUntil ? row.rateLimitedUntil.getTime() : 0;
    rateLimitDbLastSyncedAt = Date.now();
  } catch (err) {
    console.warn('[askedgar-state] rate-limit DB read failed; using module memory:', err);
  }
}

async function persistRateLimit(untilMs: number): Promise<void> {
  const db = getDb();
  if (!db) return;

  try {
    await db.insert(askedgarRuntimeState)
      .values({
        id: 'global',
        rateLimitedUntil: new Date(untilMs),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: askedgarRuntimeState.id,
        set: { rateLimitedUntil: new Date(untilMs), updatedAt: new Date() },
      });
    rateLimitDbLastSyncedAt = Date.now();
  } catch (err) {
    console.warn('[askedgar-state] rate-limit DB write failed; module memory remains authoritative for this instance:', err);
  }
}

export function setRateLimited(retryAfterSeconds: number) {
  rateLimitedUntil = Date.now() + retryAfterSeconds * 1000;
  void persistRateLimit(rateLimitedUntil);
}

function getCurrentUtcDate() {
  return new Date().toISOString().slice(0, 10);
}

export async function syncDailyTickersFromDb(): Promise<void> {
  const currentDate = getCurrentUtcDate();
  if (resetDate === currentDate && uniqueTickersToday.size > 0) return;

  const db = getDb();
  if (!db) {
    resetDate = currentDate;
    uniqueTickersToday.clear();
    return;
  }

  try {
    const rows = await db
      .select({ ticker: askedgarDailyTickers.ticker })
      .from(askedgarDailyTickers)
      .where(eq(askedgarDailyTickers.date, currentDate));

    resetDate = currentDate;
    uniqueTickersToday.clear();
    for (const row of rows) uniqueTickersToday.add(row.ticker);
  } catch (err) {
    console.warn('[askedgar-state] daily-tickers DB read failed; using module memory:', err);
    resetDate = currentDate;
  }
}

export async function persistDailyTicker(ticker: string): Promise<void> {
  const db = getDb();
  if (!db) return;

  try {
    await db.insert(askedgarDailyTickers)
      .values({ date: getCurrentUtcDate(), ticker })
      .onConflictDoNothing();
  } catch (err) {
    console.warn('[askedgar-state] daily-ticker DB write failed:', err);
  }
}


export function getRateLimitedUntil() {
  return rateLimitedUntil;
}

export function parseDailyLimit() {
  const configured = Number.parseInt(process.env.ASKEDGAR_DAILY_LIMIT ?? '', 10);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return DEFAULT_DAILY_LIMIT;
}

export function hasDailyTicker(ticker: string): boolean {
  return uniqueTickersToday.has(ticker);
}

export function getDailyTickerCount(): number {
  return uniqueTickersToday.size;
}

export function addDailyTicker(ticker: string): void {
  uniqueTickersToday.add(ticker);
}

export function getAskEdgarCallCount() {
  void syncDailyTickersFromDb();
  return uniqueTickersToday.size;
}

export function getAskEdgarDailyLimit() {
  return parseDailyLimit();
}

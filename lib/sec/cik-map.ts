import { sql } from 'drizzle-orm';

import { getDb } from '@/lib/db';
import { secTickerCik } from '@/lib/db/schema';
import { secFetchJson } from '@/lib/sec/client';

const CIK_MAP_URL = 'https://www.sec.gov/files/company_tickers_exchange.json';
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;    // 24 hours

export interface CikMapEntry {
  ticker: string;        // uppercase, share-class hyphenated (e.g. "BRK-B")
  cik: string;           // 10-digit zero-padded
  name: string;
  exchange: string | null;
}

interface CikMapResponse {
  fields: string[];
  data: Array<[number, string, string, string | null]>;
}

let inMemoryMap: Map<string, CikMapEntry> | null = null;
let lastLoadAt = 0;
let inFlightLoad: Promise<Map<string, CikMapEntry>> | null = null;

export function normalizeTicker(input: string): string {
  return input.trim().toUpperCase().replace(/\./g, '-');
}

export function padCik(cik: string | number): string {
  return String(cik).padStart(10, '0');
}

async function fetchCikMapFromSec(): Promise<Map<string, CikMapEntry>> {
  const payload = await secFetchJson<CikMapResponse>(CIK_MAP_URL);
  const map = new Map<string, CikMapEntry>();

  for (const row of payload.data) {
    const [cikNum, name, ticker, exchange] = row;
    if (!ticker || typeof ticker !== 'string') continue;
    map.set(ticker.toUpperCase(), {
      ticker: ticker.toUpperCase(),
      cik: padCik(cikNum),
      name,
      exchange: exchange ?? null,
    });
  }

  return map;
}

async function persistCikMap(map: Map<string, CikMapEntry>): Promise<void> {
  const db = getDb();
  if (!db) return;

  const rows = Array.from(map.values()).map((entry) => ({
    ticker: entry.ticker,
    cik: entry.cik,
    name: entry.name,
    exchange: entry.exchange,
    fetchedAt: new Date(),
  }));

  // Chunk to avoid hitting parameter limits on bulk insert.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await db
      .insert(secTickerCik)
      .values(chunk)
      .onConflictDoUpdate({
        target: secTickerCik.ticker,
        set: {
          cik: sql`excluded.cik`,
          name: sql`excluded.name`,
          exchange: sql`excluded.exchange`,
          fetchedAt: sql`excluded.fetched_at`,
        },
      });
  }
}

async function hydrateFromDb(): Promise<{ map: Map<string, CikMapEntry>; fetchedAt: Date | null }> {
  const db = getDb();
  if (!db) return { map: new Map(), fetchedAt: null };

  const rows = await db
    .select()
    .from(secTickerCik);

  const map = new Map<string, CikMapEntry>();
  let newest: Date | null = null;
  for (const row of rows) {
    map.set(row.ticker, {
      ticker: row.ticker,
      cik: row.cik,
      name: row.name,
      exchange: row.exchange,
    });
    if (!newest || row.fetchedAt > newest) newest = row.fetchedAt;
  }

  return { map, fetchedAt: newest };
}

async function loadCikMap(): Promise<Map<string, CikMapEntry>> {
  if (inFlightLoad) return inFlightLoad;

  inFlightLoad = (async () => {
    const { map: dbMap, fetchedAt } = await hydrateFromDb();
    const dbStale = !fetchedAt || (Date.now() - fetchedAt.getTime() > REFRESH_INTERVAL_MS);

    if (dbMap.size > 0 && !dbStale) {
      inMemoryMap = dbMap;
      lastLoadAt = Date.now();
      console.log(`[sec-cik-map] hydrated ${dbMap.size} entries from db`);
      return dbMap;
    }

    try {
      const freshMap = await fetchCikMapFromSec();
      inMemoryMap = freshMap;
      lastLoadAt = Date.now();
      await persistCikMap(freshMap).catch((err) => {
        console.warn('[sec-cik-map] persist failed:', err);
      });
      console.log(`[sec-cik-map] loaded ${freshMap.size} entries from SEC`);
      return freshMap;
    } catch (error) {
      // Fall back to whatever we have in DB even if stale.
      if (dbMap.size > 0) {
        inMemoryMap = dbMap;
        console.warn('[sec-cik-map] SEC fetch failed; using stale db copy:', error);
        return dbMap;
      }
      throw error;
    }
  })();

  try {
    return await inFlightLoad;
  } finally {
    inFlightLoad = null;
  }
}

export async function getCikForTicker(rawTicker: string): Promise<CikMapEntry | null> {
  const normalized = normalizeTicker(rawTicker);
  if (!normalized) return null;

  if (!inMemoryMap || Date.now() - lastLoadAt > REFRESH_INTERVAL_MS) {
    await loadCikMap();
  }

  return inMemoryMap?.get(normalized) ?? null;
}

// Test-only reset hook. Do not call from runtime code.
export function __resetCikMapForTests(): void {
  inMemoryMap = null;
  lastLoadAt = 0;
  inFlightLoad = null;
}

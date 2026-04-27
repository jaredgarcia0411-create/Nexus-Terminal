import { sql } from 'drizzle-orm';

import { getDb } from '@/lib/db';
import { secCompanyfactsCache } from '@/lib/db/schema';
import { SecHttpError, secFetchJson } from '@/lib/sec/client';
import { getCikForTicker, padCik } from '@/lib/sec/cik-map';

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface ShareSnapshot {
  date: string;
  outstanding: number;
}

export interface CompanyFactsResponse {
  status: 'success' | 'error';
  count: number;
  results: ShareSnapshot[];
  error?: string;
}

interface FactEntry {
  end: string;
  val: number;
  filed: string;
  accn: string;
  frame?: string;
}

interface CompanyFactsPayload {
  facts: {
    dei?: {
      EntityCommonStockSharesOutstanding?: {
        units?: { shares?: FactEntry[] };
      };
    };
    'us-gaap'?: {
      CommonStockSharesOutstanding?: {
        units?: { shares?: FactEntry[] };
      };
      CommonStockSharesIssued?: {
        units?: { shares?: FactEntry[] };
      };
    };
  };
}

// Picks the first non-empty shares array from the concept fallback chain.
// Bracket notation on 'us-gaap' is required because of the hyphen.
// Dual-class issuers: companyfacts strips per-class dimensions; the chain
// returns the aggregate total naturally without special handling.
function pickShareEntries(facts: CompanyFactsPayload['facts']): FactEntry[] {
  const candidates = [
    facts.dei?.EntityCommonStockSharesOutstanding?.units?.shares,
    facts['us-gaap']?.CommonStockSharesOutstanding?.units?.shares,
    facts['us-gaap']?.CommonStockSharesIssued?.units?.shares,
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) return c;
  }
  return [];
}

// Dedupes entries that share the same `end` date.
// Priority: (1) entry where frame !== undefined (SEC's canonical pick);
// (2) latest filed date; (3) lexicographically greatest accn.
// NEVER uses max val — that breaks reverse splits and silent restatements.
function dedupeByEnd(entries: FactEntry[]): FactEntry[] {
  const byEnd = new Map<string, FactEntry>();
  for (const entry of entries) {
    const existing = byEnd.get(entry.end);
    if (!existing) {
      byEnd.set(entry.end, entry);
      continue;
    }
    const existingHasFrame = existing.frame !== undefined;
    const entryHasFrame = entry.frame !== undefined;
    if (entryHasFrame && !existingHasFrame) { byEnd.set(entry.end, entry); continue; }
    if (!entryHasFrame && existingHasFrame) { continue; }
    if (entry.filed > existing.filed) { byEnd.set(entry.end, entry); continue; }
    if (entry.filed < existing.filed) { continue; }
    if (entry.accn > existing.accn) { byEnd.set(entry.end, entry); }
  }
  return Array.from(byEnd.values());
}

async function hydrateFromDb(cik: string): Promise<{ payload: CompanyFactsPayload; fetchedAt: Date } | null> {
  const db = getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(secCompanyfactsCache)
    .where(sql`${secCompanyfactsCache.cik} = ${cik}`);
  const row = rows[0];
  if (!row) return null;
  return { payload: row.payload as CompanyFactsPayload, fetchedAt: row.fetchedAt };
}

async function persistCache(cik: string, payload: CompanyFactsPayload): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db
    .insert(secCompanyfactsCache)
    .values({ cik, fetchedAt: new Date(), payload })
    .onConflictDoUpdate({
      target: secCompanyfactsCache.cik,
      set: {
        fetchedAt: sql`excluded.fetched_at`,
        payload: sql`excluded.payload`,
      },
    });
}

function parsePayload(payload: CompanyFactsPayload, limit: number): ShareSnapshot[] {
  const entries = pickShareEntries(payload.facts);
  const deduped = dedupeByEnd(entries);
  deduped.sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : 0));
  return deduped.slice(0, limit).map((e) => ({ date: e.end, outstanding: e.val }));
}

export async function getHistoricalOutstanding(
  rawTicker: string,
  options?: { limit?: number },
): Promise<CompanyFactsResponse> {
  const limit = options?.limit ?? 20;

  const entry = await getCikForTicker(rawTicker);
  if (!entry) {
    console.warn(`[sec-companyfacts] no CIK for ticker ${rawTicker}`);
    return { status: 'success', count: 0, results: [] };
  }
  const { cik } = entry;
  const ticker = rawTicker.trim().toUpperCase();

  const cached = await hydrateFromDb(cik);
  if (cached && Date.now() - cached.fetchedAt.getTime() < TTL_MS) {
    const results = parsePayload(cached.payload, limit);
    console.log(`[sec-companyfacts] hydrated ${results.length} entries from db for ${ticker}`);
    return { status: 'success', count: results.length, results };
  }

  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${padCik(cik)}.json`;
  try {
    const payload = await secFetchJson<CompanyFactsPayload>(url);
    await persistCache(cik, payload).catch((err) => {
      console.warn('[sec-companyfacts] persist failed:', err);
    });
    const results = parsePayload(payload, limit);
    console.log(`[sec-companyfacts] loaded ${results.length} entries from SEC for ${ticker}`);
    return { status: 'success', count: results.length, results };
  } catch (err) {
    if (err instanceof SecHttpError && err.status === 404) {
      console.warn(`[sec-companyfacts] no companyfacts for CIK ${cik}`);
      return { status: 'success', count: 0, results: [] };
    }
    if (cached) {
      const results = parsePayload(cached.payload, limit);
      console.warn(`[sec-companyfacts] SEC failed, serving stale cache for ${ticker}`);
      return { status: 'success', count: results.length, results };
    }
    const message = err instanceof Error ? err.message : 'SEC fetch failed';
    return { status: 'error', count: 0, results: [], error: message };
  }
}

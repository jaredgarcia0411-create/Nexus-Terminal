import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { jarvisKnowledgeChunks } from '@/lib/db/schema';
import type { JarvisSourceType } from '@/lib/jarvis-types';

const DEFAULT_WEB_SOURCE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_CACHED_HEADLINE_TTL_MS = 12 * 60 * 60 * 1000;

export interface ScrapeCacheResult {
  isFresh: boolean;
  lastSeenAt: Date | null;
  chunkCount: number;
}

export function getScrapeCacheTtlMs(sourceType: JarvisSourceType): number {
  if (sourceType === 'web_source') {
    const envTtl = Number(process.env.JARVIS_SCRAPE_CACHE_TTL_WEB_MS);
    return Number.isFinite(envTtl) && envTtl >= 0 ? envTtl : DEFAULT_WEB_SOURCE_TTL_MS;
  }

  if (sourceType === 'cached_headline') {
    const envTtl = Number(process.env.JARVIS_SCRAPE_CACHE_TTL_HEADLINE_MS);
    return Number.isFinite(envTtl) && envTtl >= 0 ? envTtl : DEFAULT_CACHED_HEADLINE_TTL_MS;
  }

  return 0;
}

export async function isUrlFreshInCache(url: string, sourceType: JarvisSourceType): Promise<ScrapeCacheResult> {
  const db = getDb();
  if (!db) {
    return { isFresh: false, lastSeenAt: null, chunkCount: 0 };
  }

  const rows = await db.select({
    lastSeenAt: sql<Date | null>`max(${jarvisKnowledgeChunks.lastSeenAt})`,
    chunkCount: sql<number>`count(*)::int`,
  })
    .from(jarvisKnowledgeChunks)
    .where(eq(jarvisKnowledgeChunks.sourceUrl, url));

  const row = rows[0];
  const lastSeenAt = row?.lastSeenAt ?? null;
  const chunkCount = row?.chunkCount ?? 0;
  const ttlMs = getScrapeCacheTtlMs(sourceType);

  if (!lastSeenAt || ttlMs <= 0) {
    return { isFresh: false, lastSeenAt, chunkCount: 0 };
  }

  const isFresh = Date.now() - lastSeenAt.getTime() <= ttlMs;
  if (!isFresh) {
    return { isFresh: false, lastSeenAt, chunkCount: 0 };
  }

  return { isFresh: true, lastSeenAt, chunkCount };
}

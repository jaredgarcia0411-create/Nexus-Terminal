import { and, asc, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { jarvisKnowledgeChunks, tradeTags as tradeTagsTable } from '@/lib/db/schema';
import { getEmbeddingForText } from '@/lib/jarvis-embedding';
import {
  type JarvisSourceType,
  type JarvisTradeInput,
  type ScrapedChunk,
} from '@/lib/jarvis-types';
import { CHUNK_OVERLAP_TOKENS, CHUNK_TARGET_TOKENS, chunkScrapedSource, extractTickers } from '@/lib/jarvis-scrape';

export const DEFAULT_MAX_CONTEXT_TOKENS = 6000;
export const DEFAULT_USER_STORAGE_LIMIT_BYTES = 100 * 1024 * 1024;
const CONTEXT_RESERVED_TOKENS = 500;
const SINGLE_TRADE_NOTE_TOKEN_LIMIT = 400;

export interface KnowledgeChunkRecord extends ScrapedChunk {
  id: string;
  sourceType: JarvisSourceType;
  sourceTags?: string[];
  seenCount: number;
  score: number;
  lastSeenAt: string;
}

export interface RetrieveKnowledgeOptions {
  userId: string;
  query: string;
  tickers?: string[];
  sourceTypes?: JarvisSourceType[];
  limit?: number;
  includeGlobal?: boolean;
}

export interface AssembledKnowledgeContext {
  chunks: KnowledgeChunkRecord[];
  totalTokens: number;
  truncated: boolean;
  droppedCount: number;
}

export interface KnowledgeEvictionResult {
  evicted: number;
  freedBytes: number;
  storageBytesBefore: number;
  storageBytesAfter: number;
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function normalizeTickers(input: string[] | undefined) {
  if (!input || input.length === 0) return [];
  return [...new Set(input.map((value) => value.trim().toUpperCase()).filter(Boolean))];
}

function normalizeTags(input: string[] | undefined) {
  if (!input || input.length === 0) return [];
  return [...new Set(input.map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

function toIsoString(value: Date | string | null | undefined) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  return date.toISOString();
}

function estimatedTokenCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function chunkHash(input: string) {
  const normalized = input.trim().toLowerCase();
  let hash = 0x811c9dc5;

  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = (hash * 0x01000193) >>> 0;
  }

  return hash.toString(16);
}

function toKnowledgeChunkRecord(
  row: typeof jarvisKnowledgeChunks.$inferSelect & { score: number },
): KnowledgeChunkRecord {
  const text = row.text;
  const tokenCount = row.tokenCount > 0 ? row.tokenCount : estimatedTokenCount(text);
  return {
    id: row.id,
    sourceType: row.sourceType,
    sourceUrl: row.sourceUrl,
    sourceHost: row.sourceHost,
    sourceTitle: row.sourceTitle,
    sourceTags: normalizeTags(row.sourceTags),
    index: row.chunkIndex,
    startToken: row.startToken,
    endToken: row.endToken,
    tokenCount,
    text,
    hash: row.hash,
    relevance: row.relevance,
    tickers: normalizeTickers(row.tickers),
    publishedAt: toIsoString(row.publishedAt),
    author: row.author ?? undefined,
    seenCount: row.seenCount,
    score: row.score,
    lastSeenAt: toIsoString(row.lastSeenAt) ?? new Date(0).toISOString(),
  };
}

function vectorLiteral(values: number[]) {
  return `[${values.join(',')}]`;
}

export async function ingestKnowledgeChunks(options: {
  userId: string;
  chunks: Array<ScrapedChunk & { relevance?: number }>;
  sourceType: JarvisSourceType;
}) {
  const db = getDb();
  if (!db || options.chunks.length === 0) return;

  const now = new Date();

  for (const chunk of options.chunks) {
    const chunkText = chunk.text.trim();
    if (!chunkText) continue;

    const tickers = normalizeTickers(chunk.tickers);
    const sourceTags = normalizeTags(chunk.sourceTags);
    const relevance = Number.isFinite(chunk.relevance ?? NaN)
      ? Number((chunk.relevance ?? 0).toFixed(3))
      : 0;
    const embedding = await getEmbeddingForText(chunkText).catch(() => null);

    await db.insert(jarvisKnowledgeChunks)
      .values({
        id: crypto.randomUUID(),
        userId: options.userId,
        sourceUrl: chunk.sourceUrl,
        sourceHost: chunk.sourceHost,
        sourceTitle: chunk.sourceTitle,
        sourceType: options.sourceType,
        chunkIndex: chunk.index,
        startToken: chunk.startToken,
        endToken: chunk.endToken,
        tokenCount: Math.max(1, chunk.tokenCount || estimatedTokenCount(chunkText)),
        text: chunkText,
        hash: chunk.hash,
        relevance,
        tickers,
        sourceTags,
        publishedAt: chunk.publishedAt ? new Date(chunk.publishedAt) : undefined,
        author: chunk.author,
        embedding,
        textSearch: sql`to_tsvector('english', ${chunkText})`,
        seenCount: 1,
        createdAt: now,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: [jarvisKnowledgeChunks.sourceType, jarvisKnowledgeChunks.sourceHost, jarvisKnowledgeChunks.hash],
        set: {
          sourceUrl: chunk.sourceUrl,
          sourceTitle: chunk.sourceTitle,
          chunkIndex: chunk.index,
          startToken: chunk.startToken,
          endToken: chunk.endToken,
          tokenCount: Math.max(1, chunk.tokenCount || estimatedTokenCount(chunkText)),
          text: chunkText,
          relevance: sql`GREATEST(${jarvisKnowledgeChunks.relevance}, ${relevance})`,
          tickers,
          sourceTags,
          publishedAt: chunk.publishedAt ? new Date(chunk.publishedAt) : null,
          author: chunk.author ?? null,
          embedding: embedding ?? jarvisKnowledgeChunks.embedding,
          textSearch: sql`to_tsvector('english', ${chunkText})`,
          seenCount: sql`${jarvisKnowledgeChunks.seenCount} + 1`,
          lastSeenAt: now,
        },
      });
  }

  if (options.sourceType !== 'web_source') {
    await checkAndEvictKnowledgeForUser(options.userId);
  }
}

async function getTradeTagsByTradeId(userId: string, tradeIds: string[]) {
  const db = getDb();
  if (!db || tradeIds.length === 0) {
    return new Map<string, string[]>();
  }

  const rows = await db.select({
    tradeId: tradeTagsTable.tradeId,
    tag: tradeTagsTable.tag,
  })
    .from(tradeTagsTable)
    .where(and(
      eq(tradeTagsTable.userId, userId),
      inArray(tradeTagsTable.tradeId, tradeIds),
    ));

  const tagMap = new Map<string, string[]>();
  for (const row of rows) {
    const list = tagMap.get(row.tradeId) ?? [];
    list.push(row.tag);
    tagMap.set(row.tradeId, list);
  }

  return tagMap;
}

function formatPnl(value: number | undefined) {
  if (!Number.isFinite(value ?? NaN)) return 'N/A';
  return `${(value ?? 0) >= 0 ? '+' : ''}${(value ?? 0).toFixed(2)}`;
}

function buildTradeJournalChunks(userId: string, trade: JarvisTradeInput & { tags?: string[] }) {
  const tags = normalizeTags(trade.tags);
  const symbol = trade.symbol.trim().toUpperCase();
  const direction = trade.direction ?? 'N/A';
  const date = new Date(trade.date);
  const dateLabel = Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : String(trade.date);
  const performanceLine = `Trade Journal Entry: symbol ${symbol}; date ${dateLabel}; direction ${direction}; pnl ${formatPnl(trade.netPnl ?? trade.pnl)}; quantity ${trade.totalQuantity ?? 'N/A'}.`;
  const tagsLine = tags.length > 0 ? `Tags: ${tags.join(', ')}.` : 'Tags: none.';
  const notesText = String(trade.notes ?? '').trim();
  if (!notesText) return [] as ScrapedChunk[];

  const baseText = `${performanceLine} ${tagsLine} Notes: ${notesText}`;
  const sourceUrl = `jarvis://trade/${trade.id}`;
  const sourceHost = `journal.${userId}`;
  const sourceTitle = `Trade note ${symbol} ${dateLabel}`;
  const combinedTickers = normalizeTickers([symbol, ...extractTickers(baseText)]);

  if (estimatedTokenCount(baseText) <= SINGLE_TRADE_NOTE_TOKEN_LIMIT) {
    const tokenCount = estimatedTokenCount(baseText);
    return [{
      sourceType: 'trade_journal' as const,
      sourceUrl,
      sourceHost,
      sourceTitle,
      sourceTags: tags,
      index: 0,
      startToken: 0,
      endToken: tokenCount,
      tokenCount,
      text: baseText,
      hash: chunkHash(`${trade.id}:0:${baseText}`),
      relevance: 0.72,
      tickers: combinedTickers,
      author: 'trade_journal',
    }];
  }

  const chunked = chunkScrapedSource({
    url: sourceUrl,
    title: sourceTitle,
    host: sourceHost,
    excerpt: baseText.slice(0, 2500),
    scrapedAt: new Date(),
    body: baseText,
    tickers: combinedTickers,
    author: 'trade_journal',
  }, CHUNK_TARGET_TOKENS, CHUNK_OVERLAP_TOKENS);

  return chunked.map((chunk, index) => ({
    ...chunk,
    sourceType: 'trade_journal' as const,
    sourceTags: tags,
    hash: chunkHash(`${trade.id}:${index}:${chunk.text}`),
    relevance: Number((0.7 - index * 0.02).toFixed(3)),
  }));
}

export async function syncTradeJournalChunks(userId: string, trades: JarvisTradeInput[]) {
  const db = getDb();
  if (!db || trades.length === 0) return;

  const candidates = trades.filter((trade) => String(trade.notes ?? '').trim().length > 0);
  if (candidates.length === 0) return;

  const tradeIds = candidates.map((trade) => trade.id);
  const tagMap = await getTradeTagsByTradeId(userId, tradeIds);

  const missingRows = await db.select({ sourceUrl: jarvisKnowledgeChunks.sourceUrl })
    .from(jarvisKnowledgeChunks)
    .where(and(
      eq(jarvisKnowledgeChunks.userId, userId),
      eq(jarvisKnowledgeChunks.sourceType, 'trade_journal'),
      inArray(jarvisKnowledgeChunks.sourceUrl, tradeIds.map((tradeId) => `jarvis://trade/${tradeId}`)),
    ));
  const existing = new Set(missingRows.map((row) => row.sourceUrl));

  const chunks: ScrapedChunk[] = [];
  for (const trade of candidates) {
    const sourceUrl = `jarvis://trade/${trade.id}`;
    if (existing.has(sourceUrl)) continue;

    const enrichedTrade = {
      ...trade,
      tags: trade.tags && trade.tags.length > 0 ? trade.tags : tagMap.get(trade.id) ?? [],
    };
    chunks.push(...buildTradeJournalChunks(userId, enrichedTrade));
  }

  await ingestKnowledgeChunks({
    userId,
    sourceType: 'trade_journal',
    chunks,
  });
}

export async function retrieveKnowledgeChunks(options: RetrieveKnowledgeOptions): Promise<KnowledgeChunkRecord[]> {
  const db = getDb();
  if (!db) return [];

  const sourceTypes = options.sourceTypes && options.sourceTypes.length > 0
    ? options.sourceTypes
    : ['web_source', 'trade_journal', 'user_document'] as JarvisSourceType[];
  const includeGlobal = options.includeGlobal ?? true;
  const limit = Math.max(1, Math.min(options.limit ?? 20, 200));
  const query = options.query.trim();
  const tickers = normalizeTickers(options.tickers);
  const queryEmbedding = query ? await getEmbeddingForText(query).catch(() => null) : null;

  const nonGlobalTypes = sourceTypes.filter((sourceType) => sourceType !== 'web_source');

  const scopeFilter = includeGlobal
    ? or(
      sourceTypes.includes('web_source') ? eq(jarvisKnowledgeChunks.sourceType, 'web_source') : undefined,
      nonGlobalTypes.length > 0
        ? and(eq(jarvisKnowledgeChunks.userId, options.userId), inArray(jarvisKnowledgeChunks.sourceType, nonGlobalTypes))
        : undefined,
    )
    : and(eq(jarvisKnowledgeChunks.userId, options.userId), inArray(jarvisKnowledgeChunks.sourceType, sourceTypes));

  const queryFilter = query
    ? sql`(${jarvisKnowledgeChunks.textSearch} @@ plainto_tsquery('english', ${query}) OR ${jarvisKnowledgeChunks.embedding} IS NOT NULL)`
    : undefined;

  const keywordScore = query
    ? sql<number>`ts_rank(${jarvisKnowledgeChunks.textSearch}, plainto_tsquery('english', ${query}))`
    : sql<number>`0`;
  const semanticScore = queryEmbedding && queryEmbedding.length > 0
    ? sql<number>`GREATEST(0, 1 - (${jarvisKnowledgeChunks.embedding} <=> ${vectorLiteral(queryEmbedding)}::vector))`
    : sql<number>`0`;
  const recencyScore = sql<number>`GREATEST(0, LEAST(1, 1 - (EXTRACT(EPOCH FROM (now() - ${jarvisKnowledgeChunks.lastSeenAt})) / 86400 / 30)))`;
  const score = sql<number>`((${keywordScore}) * 0.35) + ((${semanticScore}) * 0.35) + ((${recencyScore}) * 0.15) + (COALESCE(${jarvisKnowledgeChunks.relevance}, 0) * 0.15)`;

  const rows = await db.select({
    id: jarvisKnowledgeChunks.id,
    userId: jarvisKnowledgeChunks.userId,
    sourceUrl: jarvisKnowledgeChunks.sourceUrl,
    sourceHost: jarvisKnowledgeChunks.sourceHost,
    sourceTitle: jarvisKnowledgeChunks.sourceTitle,
    sourceType: jarvisKnowledgeChunks.sourceType,
    sourceTags: jarvisKnowledgeChunks.sourceTags,
    chunkIndex: jarvisKnowledgeChunks.chunkIndex,
    startToken: jarvisKnowledgeChunks.startToken,
    endToken: jarvisKnowledgeChunks.endToken,
    tokenCount: jarvisKnowledgeChunks.tokenCount,
    text: jarvisKnowledgeChunks.text,
    hash: jarvisKnowledgeChunks.hash,
    relevance: jarvisKnowledgeChunks.relevance,
    tickers: jarvisKnowledgeChunks.tickers,
    publishedAt: jarvisKnowledgeChunks.publishedAt,
    author: jarvisKnowledgeChunks.author,
    embedding: jarvisKnowledgeChunks.embedding,
    textSearch: jarvisKnowledgeChunks.textSearch,
    seenCount: jarvisKnowledgeChunks.seenCount,
    createdAt: jarvisKnowledgeChunks.createdAt,
    lastSeenAt: jarvisKnowledgeChunks.lastSeenAt,
    score,
  })
    .from(jarvisKnowledgeChunks)
    .where(and(scopeFilter, queryFilter))
    .orderBy(desc(score), desc(jarvisKnowledgeChunks.lastSeenAt))
    .limit(tickers.length > 0 ? limit * 4 : limit);

  const filteredRows = tickers.length > 0
    ? rows.filter((row) => row.tickers.some((ticker) => tickers.includes(ticker)))
    : rows;

  return filteredRows.slice(0, limit).map(toKnowledgeChunkRecord);
}

export function assembleKnowledgeContext(
  chunks: KnowledgeChunkRecord[],
  maxTokens = parsePositiveInt(process.env.JARVIS_MAX_CONTEXT_TOKENS, DEFAULT_MAX_CONTEXT_TOKENS),
): AssembledKnowledgeContext {
  const effectiveBudget = Math.max(256, maxTokens - CONTEXT_RESERVED_TOKENS);
  let totalTokens = 0;
  const selected: KnowledgeChunkRecord[] = [];

  for (const chunk of chunks) {
    const tokenCount = Math.max(1, chunk.tokenCount || estimatedTokenCount(chunk.text));
    if (totalTokens + tokenCount > effectiveBudget) {
      continue;
    }

    selected.push(chunk);
    totalTokens += tokenCount;
  }

  return {
    chunks: selected,
    totalTokens,
    truncated: selected.length < chunks.length,
    droppedCount: Math.max(0, chunks.length - selected.length),
  };
}

export async function getUserKnowledgeStorageBytes(userId: string) {
  const db = getDb();
  if (!db) return 0;

  const [row] = await db.select({
    totalBytes: sql<number>`COALESCE(SUM(octet_length(${jarvisKnowledgeChunks.text})), 0)`,
  })
    .from(jarvisKnowledgeChunks)
    .where(and(
      eq(jarvisKnowledgeChunks.userId, userId),
      ne(jarvisKnowledgeChunks.sourceType, 'web_source'),
    ));

  return Number(row?.totalBytes ?? 0);
}

export async function checkAndEvictKnowledgeForUser(userId: string): Promise<KnowledgeEvictionResult> {
  const db = getDb();
  if (!db) {
    return {
      evicted: 0,
      freedBytes: 0,
      storageBytesBefore: 0,
      storageBytesAfter: 0,
    };
  }

  const storageLimit = parsePositiveInt(process.env.JARVIS_USER_STORAGE_LIMIT_BYTES, DEFAULT_USER_STORAGE_LIMIT_BYTES);
  const storageBytesBefore = await getUserKnowledgeStorageBytes(userId);

  if (storageBytesBefore <= storageLimit) {
    return {
      evicted: 0,
      freedBytes: 0,
      storageBytesBefore,
      storageBytesAfter: storageBytesBefore,
    };
  }

  const overage = storageBytesBefore - storageLimit;
  const targetBytesToFree = overage + Math.ceil(storageLimit * 0.1);

  const candidates = await db.select({
    id: jarvisKnowledgeChunks.id,
    bytes: sql<number>`octet_length(${jarvisKnowledgeChunks.text})`,
  })
    .from(jarvisKnowledgeChunks)
    .where(and(
      eq(jarvisKnowledgeChunks.userId, userId),
      ne(jarvisKnowledgeChunks.sourceType, 'web_source'),
    ))
    .orderBy(asc(jarvisKnowledgeChunks.relevance), asc(jarvisKnowledgeChunks.lastSeenAt));

  const evictIds: string[] = [];
  let freedBytes = 0;

  for (const candidate of candidates) {
    evictIds.push(candidate.id);
    freedBytes += Number(candidate.bytes ?? 0);
    if (freedBytes >= targetBytesToFree) {
      break;
    }
  }

  if (evictIds.length > 0) {
    await db.delete(jarvisKnowledgeChunks)
      .where(inArray(jarvisKnowledgeChunks.id, evictIds));
  }

  const storageBytesAfter = await getUserKnowledgeStorageBytes(userId);

  return {
    evicted: evictIds.length,
    freedBytes,
    storageBytesBefore,
    storageBytesAfter,
  };
}

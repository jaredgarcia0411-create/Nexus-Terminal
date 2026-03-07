import { type JarvisSourceContext, type ScrapedChunk, type ScrapedSource } from '@/lib/jarvis-types';

const TITLE_REGEX = /<title[^>]*>([\s\S]*?)<\/title>/i;
const ARTICLE_TAG_REGEX = /<article[^>]*>([\s\S]*?)<\/article>/i;
const BODY_TAG_REGEX = /<body[^>]*>([\s\S]*?)<\/body>/i;
const META_TAG_REGEX = /<meta[^>]+(?:name|property|itemprop)=["']?([^"']+)["'][^>]*content=["']([^"']+)["'][^>]*>/gi;
const SCRIPT_TAGS_REGEX = /<script[\s\S]*?<\/script>/gi;
const STYLE_TAGS_REGEX = /<style[\s\S]*?<\/style>/gi;
const COMMENT_TAGS_REGEX = /<!--([\s\S]*?)-->/g;
const TAGS_REGEX = /<[^>]+>/g;

export const CHUNK_TARGET_TOKENS = 512;
export const CHUNK_OVERLAP_TOKENS = 80;
export const CHUNK_MAX_CONTEXT_PREVIEW = 240;
const NEAR_DUPLICATE_SIMILARITY = 0.9;

const PUBLISHED_DATE_KEYS = [
  'article:published_time',
  'article:modified_time',
  'publication_date',
  'og:article:published_time',
  'pubdate',
  'date',
];

const AUTHOR_KEYS = [
  'author',
  'dc.creator',
  'twitter:creator',
  'article:author',
];

function normalizeText(input: string) {
  return input
    .replace(/\r\n/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

function sanitizeHtmlForText(input: string) {
  return normalizeText(
    input
      .replace(COMMENT_TAGS_REGEX, ' ')
      .replace(SCRIPT_TAGS_REGEX, ' ')
      .replace(STYLE_TAGS_REGEX, ' ')
      .replace(/<[^/]{0,}head[^>]*>[\s\S]*?<\/head>/gi, ' '),
  );
}

function extractMetaValues(html: string) {
  const values = new Map<string, string>();

  for (const match of html.matchAll(META_TAG_REGEX)) {
    const rawName = match[1]?.trim().toLowerCase();
    const content = match[2]?.trim();
    if (!rawName || !content) continue;
    values.set(rawName, content);
  }

  return values;
}

function extractPublishedDate(html: string) {
  const values = extractMetaValues(html);
  for (const key of PUBLISHED_DATE_KEYS) {
    const candidate = values.get(key.toLowerCase());
    if (!candidate) continue;

    const parsed = new Date(candidate);
    if (Number.isFinite(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  const fallbackMatch = html.match(/<time[^>]+datetime=["']([^"']+)["'][^>]*>/i);
  if (!fallbackMatch?.[1]) return undefined;

  const parsed = new Date(fallbackMatch[1]);
  if (!Number.isFinite(parsed.getTime())) return undefined;

  return parsed.toISOString();
}

function extractAuthor(html: string) {
  const values = extractMetaValues(html);
  for (const key of AUTHOR_KEYS) {
    const author = values.get(key.toLowerCase());
    if (author) {
      return author;
    }
  }

  return undefined;
}

function cleanTagContent(raw: string) {
  const withMetaRemoved = raw
    .replace(/<meta[^>]*>/gi, ' ')
    .replace(TAGS_REGEX, ' ');
  return normalizeText(withMetaRemoved);
}

export function extractText(rawHtml: string) {
  const content =
    (ARTICLE_TAG_REGEX.exec(rawHtml)?.[1])
    ?? (BODY_TAG_REGEX.exec(rawHtml)?.[1])
    ?? rawHtml;
  return cleanTagContent(sanitizeHtmlForText(content));
}

export function extractTitle(rawHtml: string, fallback: string) {
  const values = extractMetaValues(rawHtml);
  const ogTitle = values.get('og:title');
  if (ogTitle) return ogTitle;

  const titleMatch = rawHtml.match(TITLE_REGEX);
  return titleMatch?.[1] ? normalizeText(titleMatch[1]) : fallback;
}

export function extractTickers(input: string) {
  const direct = new Set<string>();
  const directMatches = input.matchAll(/\$([A-Z]{1,5}(?:\.[A-Z]{1,2})?)/g);

  for (const match of directMatches) {
    const symbol = match[1]?.toUpperCase();
    if (symbol) direct.add(symbol);
  }

  return [...direct];
}

function splitWhitespace(text: string) {
  return normalizeText(text).split(' ').filter(Boolean);
}

function simpleHash(input: string) {
  const normalized = normalizeText(input).toLowerCase();
  let hash = 0x811c9dc5;

  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = (hash * 0x01000193) >>> 0;
  }

  return hash.toString(16);
}

function tokenJaccardRatio(a: string, b: string) {
  const tokensA = splitWhitespace(a);
  const tokensB = splitWhitespace(b);

  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let intersection = 0;

  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }

  const denominator = Math.min(setA.size, setB.size);
  if (denominator === 0) return 0;

  return intersection / denominator;
}

export function buildStructuredSource(url: string, html: string, now = new Date()): ScrapedSource {
  const host = new URL(url).hostname;
  const title = extractTitle(html, host);
  const body = extractText(html);
  const publishedAt = extractPublishedDate(html);
  const author = extractAuthor(html);
  const tickers = extractTickers(`${title} ${body}`);

  return {
    url,
    title,
    host,
    excerpt: body.slice(0, 2500),
    scrapedAt: now,
    body,
    publishedAt,
    author,
    tickers,
  };
}

export function chunkScrapedSource(source: ScrapedSource, targetTokens = CHUNK_TARGET_TOKENS, overlapTokens = CHUNK_OVERLAP_TOKENS): ScrapedChunk[] {
  const body = source.body ?? source.excerpt;
  const tokens = splitWhitespace(body);

  if (tokens.length === 0) return [];

  const normalizedTarget = Math.max(32, targetTokens);
  const normalizedOverlap = Math.max(0, Math.min(overlapTokens, normalizedTarget - 1));
  const step = Math.max(1, normalizedTarget - normalizedOverlap);

  const chunks: ScrapedChunk[] = [];
  for (let start = 0; start < tokens.length; start += step) {
    const end = Math.min(start + normalizedTarget, tokens.length);
    const chunkTokens = tokens.slice(start, end);

    if (chunkTokens.length === 0) break;

    chunks.push({
      sourceUrl: source.url,
      sourceHost: source.host,
      sourceTitle: source.title,
      sourceType: 'web_source',
      index: chunks.length,
      startToken: start,
      endToken: end,
      tokenCount: chunkTokens.length,
      text: chunkTokens.join(' '),
      hash: simpleHash(chunkTokens.join(' ')),
      tickers: source.tickers ? [...source.tickers, ...extractTickers(chunkTokens.join(' '))] : extractTickers(chunkTokens.join(' ')),
      publishedAt: source.publishedAt,
      author: source.author,
    });

    if (end === tokens.length) {
      break;
    }
  }

  return chunks;
}

export function dedupeSourceChunks(chunks: ScrapedChunk[]) {
  const unique: ScrapedChunk[] = [];
  const hashes = new Set<string>();

  for (const chunk of chunks) {
    const hasExactMatch = hashes.has(chunk.hash);
    if (hasExactMatch) {
      continue;
    }

    const isNearDuplicate = unique.some((entry) => {
      const similarity = tokenJaccardRatio(entry.text, chunk.text);
      return similarity >= NEAR_DUPLICATE_SIMILARITY && Math.abs(entry.tokenCount - chunk.tokenCount) <= 8;
    });

    if (isNearDuplicate) {
      hashes.add(chunk.hash);
      continue;
    }

    hashes.add(chunk.hash);
    unique.push(chunk);
  }

  return unique;
}

export function rankSourceChunks(
  chunks: ScrapedChunk[],
  options: {
    tradeTickers?: string[];
    trustByHost?: Record<string, number>;
    now?: Date;
  } = {},
) {
  const now = options.now ?? new Date();
  const tradeTickerSet = new Set(
    (options.tradeTickers ?? []).map((value) => value.trim().toUpperCase()).filter(Boolean),
  );
  const trusted = options.trustByHost ?? {};

  return chunks
    .map((chunk) => {
      const matchedTickers = chunk.tickers.filter((ticker) => tradeTickerSet.has(ticker));
      const tickerScore = tradeTickerSet.size === 0 ? 0.5 : matchedTickers.length / tradeTickerSet.size;

      const trustScore = trusted[chunk.sourceHost] ?? 0.6;

      let freshness = 0.45;
      if (chunk.publishedAt) {
        const published = new Date(chunk.publishedAt);
        if (Number.isFinite(published.getTime())) {
          const ageInDays = Math.max(0, (now.getTime() - published.getTime()) / (1000 * 60 * 60 * 24));
          freshness = Math.max(0, Math.min(1, 1 - ageInDays / 30));
        }
      }

      const relevance = Number(((trustScore * 0.4) + (freshness * 0.3) + (tickerScore * 0.3)).toFixed(3));

      return {
        ...chunk,
        relevance,
      };
    })
    .sort((a, b) => {
      if (b.relevance !== a.relevance) return b.relevance - a.relevance;
      return b.tokenCount - a.tokenCount;
    });
}

export function buildSourceContexts(
  rankedChunks: Array<ScrapedChunk & { relevance: number }>,
  limit = 8,
): JarvisSourceContext[] {
  const byUrl = new Map<string, JarvisSourceContext & { relevance: number }>();

  for (const chunk of rankedChunks) {
    const existing = byUrl.get(chunk.sourceUrl);
    if (!existing || chunk.relevance > existing.relevance) {
      byUrl.set(chunk.sourceUrl, {
        relevance: chunk.relevance,
        url: chunk.sourceUrl,
        title: chunk.sourceTitle,
        host: chunk.sourceHost,
        sourceType: chunk.sourceType,
        sourceTags: chunk.sourceTags,
        excerpt: chunk.text.slice(0, CHUNK_MAX_CONTEXT_PREVIEW),
        publishedAt: chunk.publishedAt,
        author: chunk.author,
        tickers: [...new Set(chunk.tickers)],
      });
      continue;
    }
  }

  return [...byUrl.values()]
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, limit);
}

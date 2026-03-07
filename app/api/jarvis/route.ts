import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { internalServerError, logRouteError, parseJsonBody } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { jarvisSourceUrls, trades as tradesTable } from '@/lib/db/schema';
import { ensureUser, requireUser } from '@/lib/server-db-utils';
import {
  type JarvisMode,
  type JarvisRequest,
  type ScrapeResult,
  type ScrapedSource,
  type JarvisTradeInput,
} from '@/lib/jarvis-types';
import { getBlockedUrlMessage, getTrustScoreForHost, isUrlAllowed } from '@/lib/jarvis-allowlist';
import { getSourcePack } from '@/lib/jarvis-source-packs';
import {
  buildSourceContexts,
  buildStructuredSource,
  chunkScrapedSource,
  dedupeSourceChunks,
  rankSourceChunks,
} from '@/lib/jarvis-scrape';
import {
  buildStructuredFallbackFromSources,
  parseJarvisLlmResponse,
} from '@/lib/jarvis-response';

const MAX_SCRAPE_URLS = 5;
const MAX_REMEMBERED_URLS = 20;
const SCRAPE_TIMEOUT_MS = 10_000;
const CHUNK_CONTEXT_LIMIT = 240;
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v3.2';
const DEFAULT_DEEPSEEK_BASE_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const JARVIS_SYSTEM_PROMPT = [
  'You are Jarvis, a focused trading assistant. Be concise, practical, and risk-aware.',
  'Return ONLY valid JSON, with no markdown, no code fences, and no explanatory prose.',
  'Output must be a single JSON object with exactly these keys: tldr, findings, actionSteps, risks.',
  'Use this schema:',
  '{',
  '  "tldr": "<one sentence summary>",',
  '  "findings": ["<bullet style finding>", "..."],',
  '  "actionSteps": ["<concrete action>", "..."],',
  '  "risks": ["<risk-aware caveat>", "..."]',
  '}',
  'Prefer non-empty findings/actionSteps/risks; use "No items identified." only when no valid item is known.',
].join('\n');

function asDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatMoney(value: number) {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function summarizeTrades(input: JarvisTradeInput[]) {
  const trades = input
    .map((trade) => {
      const date = asDate(trade.date);
      if (!date) return null;
      return {
        ...trade,
        date,
        pnl: Number(trade.netPnl ?? trade.pnl ?? 0),
        qty: Number(trade.totalQuantity ?? 0),
        notes: trade.notes,
      };
    })
    .filter((trade): trade is NonNullable<typeof trade> => trade != null);

  if (trades.length === 0) {
    return {
      totalTrades: 0,
      totalPnl: 0,
      winRate: 0,
      averagePnl: 0,
      topSymbols: [] as string[],
      todayTrades: 0,
      todayPnl: 0,
      latestTrades: [] as typeof trades,
    };
  }

  const today = new Date();
  const isToday = (date: Date) =>
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();

  const totalPnl = trades.reduce((sum, trade) => sum + trade.pnl, 0);
  const wins = trades.filter((trade) => trade.pnl > 0).length;
  const symbols = new Map<string, number>();
  for (const trade of trades) {
    symbols.set(trade.symbol, (symbols.get(trade.symbol) ?? 0) + 1);
  }

  const sortedByDate = [...trades].sort((a, b) => b.date.getTime() - a.date.getTime());
  const topSymbols = [...symbols.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([symbol]) => symbol);

  const todayTrades = trades.filter((trade) => isToday(trade.date));
  const todayPnl = todayTrades.reduce((sum, trade) => sum + trade.pnl, 0);

  return {
    totalTrades: trades.length,
    totalPnl,
    winRate: (wins / trades.length) * 100,
    averagePnl: totalPnl / trades.length,
    topSymbols,
    todayTrades: todayTrades.length,
    todayPnl,
    latestTrades: sortedByDate.slice(0, 5),
  };
}

function toModePrompt(mode: JarvisMode, summary: ReturnType<typeof summarizeTrades>, prompt: string) {
  if (mode === 'daily-summary') {
    return [
      'Daily Summary:',
      `- Trades today: ${summary.todayTrades}`,
      `- PnL today: ${formatMoney(summary.todayPnl)}`,
      `- Total trades tracked: ${summary.totalTrades}`,
      `- Win rate: ${summary.winRate.toFixed(1)}%`,
      `- Most active symbols: ${summary.topSymbols.join(', ') || 'N/A'}`,
      '',
      'Focus for next session:',
      summary.todayPnl >= 0
        ? '- Protect gains and keep position sizing consistent.'
        : '- Tighten risk parameters and reduce impulse entries.',
    ].join('\n');
  }

  if (mode === 'trade-analysis') {
    const lines = summary.latestTrades
      .map((trade) => {
        const details = [trade.direction ?? '', formatMoney(trade.pnl)];
        const notes = trade.notes ? ` notes: ${trade.notes.slice(0, 120)}` : '';
        return `- ${trade.symbol} ${details.join(' ')}${notes}`;
      })
      .join('\n');
    return [
      'Trade Analysis:',
      `- Sample size: ${summary.totalTrades} trades`,
      `- Net PnL: ${formatMoney(summary.totalPnl)}`,
      `- Average trade: ${formatMoney(summary.averagePnl)}`,
      `- Win rate: ${summary.winRate.toFixed(1)}%`,
      '',
      'Most recent trades:',
      lines || '- No trades available',
      '',
      prompt ? `Your request: ${prompt}` : 'Tip: ask Jarvis for setup-specific feedback to get a deeper review.',
    ].join('\n');
  }

  return [
    'Jarvis Assistant:',
    prompt || 'No specific prompt supplied.',
    '',
    `Current performance snapshot: ${summary.totalTrades} trades, ${formatMoney(summary.totalPnl)} net, ${summary.winRate.toFixed(1)}% win rate.`,
  ].join('\n');
}

async function scrapeUrl(url: string): Promise<ScrapedSource> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      url,
      title: '',
      host: '',
      excerpt: '',
      scrapedAt: new Date(),
      error: 'Invalid URL format.',
    };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return {
      url,
      title: '',
      host: parsed.hostname,
      excerpt: '',
      scrapedAt: new Date(),
      error: 'Only http/https URLs are allowed.',
    };
  }

  const allowResult = isUrlAllowed(parsed.toString());
  if (!allowResult.allowed) {
    return {
      url,
      title: parsed.hostname,
      host: parsed.hostname,
      excerpt: '',
      scrapedAt: new Date(),
      blocked: true,
      error: getBlockedUrlMessage(parsed.toString()),
    };
  }

  let res: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);

  try {
    res = await fetch(parsed.toString(), {
      headers: { 'User-Agent': 'Nexus-Jarvis/1.0' },
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    const message = error instanceof Error ? error.message : 'Unknown error';
    const isTimeout = message === 'This operation was aborted' || error instanceof DOMException && error.name === 'AbortError';

    return {
      url,
      title: parsed.hostname,
      host: parsed.hostname,
      excerpt: '',
      scrapedAt: new Date(),
      error: isTimeout ? `Scrape timeout after ${SCRAPE_TIMEOUT_MS / 1000}s` : `Scrape failed: ${message}`,
    };
  }
  clearTimeout(timeout);

  if (!res.ok) {
    return {
      url,
      title: parsed.hostname,
      host: parsed.hostname,
      excerpt: '',
      scrapedAt: new Date(),
      error: `Request failed with status ${res.status}`,
    };
  }

  const html = await res.text();
  return buildStructuredSource(parsed.toString(), html, new Date());
}

function normalizeScrapeUrls(urls?: string[]) {
  const incoming = Array.isArray(urls) ? urls : [];

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const raw of incoming) {
    const value = String(raw ?? '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
    if (normalized.length >= MAX_SCRAPE_URLS) break;
  }

  return normalized;
}

async function scrapeSources(urls: string[], tradeTickers: string[]): Promise<ScrapeResult> {
  const results = await Promise.all(urls.map((url) => scrapeUrl(url)));

  const sources = results.filter((result): result is ScrapedSource => !result.blocked && !result.error);
  const warnings = results
    .filter((result): result is ScrapedSource => Boolean(result.error))
    .map((result) => result.error!);

  const chunks = dedupeSourceChunks(
    sources
      .flatMap((source) => chunkScrapedSource(source)),
  );

  const rankedChunks = rankSourceChunks(chunks, {
    tradeTickers,
    trustByHost: Object.fromEntries(sources.map((source) => [source.host, getTrustScoreForHost(source.host)])),
  });
  const sourceContexts = buildSourceContexts(rankedChunks);

  return { sources, chunks: rankedChunks, sourceContexts, warnings };
}

function sourceSummaryFor(scrapedSources: ScrapedSource[]) {
  if (scrapedSources.length === 0) return undefined;
  return scrapedSources
    .slice(0, 5)
    .map((source) => `${source.title} (${source.host})`)
    .join('; ');
}

function extractTradeTickers(trades: JarvisTradeInput[]) {
  return [...new Set(trades.map((trade) => trade.symbol.trim().toUpperCase()).filter(Boolean))];
}

async function rememberUrls(
  user: { id: string; email: string; name: string | null; picture: string | null },
  urls: string[],
) {
  const db = getDb();
  if (!db || urls.length === 0) return;

  await ensureUser(db, user);

  await db.insert(jarvisSourceUrls)
    .values(urls.map((url) => ({ userId: user.id, url, lastUsedAt: new Date() })))
    .onConflictDoUpdate({
      target: [jarvisSourceUrls.userId, jarvisSourceUrls.url],
      set: {
        lastUsedAt: new Date(),
        useCount: sql`${jarvisSourceUrls.useCount} + 1`,
      },
    });

  const staleRows = await db.select({ url: jarvisSourceUrls.url })
    .from(jarvisSourceUrls)
    .where(eq(jarvisSourceUrls.userId, user.id))
    .orderBy(desc(jarvisSourceUrls.lastUsedAt))
    .offset(MAX_REMEMBERED_URLS);

  if (staleRows.length > 0) {
    await db.delete(jarvisSourceUrls).where(
      and(
        eq(jarvisSourceUrls.userId, user.id),
        inArray(jarvisSourceUrls.url, staleRows.map((row) => row.url)),
      ),
    );
  }
}

async function loadRememberedUrls(userId: string) {
  const db = getDb();
  if (!db) return [] as string[];

  const rows = await db.select({ url: jarvisSourceUrls.url })
    .from(jarvisSourceUrls)
    .where(eq(jarvisSourceUrls.userId, userId))
    .orderBy(desc(jarvisSourceUrls.lastUsedAt))
    .limit(MAX_REMEMBERED_URLS);

  return rows.map((row) => row.url);
}

export async function GET() {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const urls = await loadRememberedUrls(authState.user.id);
    return Response.json({ urls });
  } catch (error) {
    logRouteError('jarvis.get', error);
    return internalServerError();
  }
}

async function askLlm(
  basePrompt: string,
  sources: ScrapedSource[],
  chunks: ScrapeResult['chunks'],
) {
  const apiKey = process.env.JARVIS_API_KEY ?? process.env.NVIDIA_API_KEY;
  if (!apiKey) return null;

  const model = process.env.JARVIS_MODEL || DEFAULT_DEEPSEEK_MODEL;
  const baseUrl = process.env.JARVIS_API_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL;
  const previewChunks = chunks.length > 0 ? chunks.slice(0, 12) : [];
  const extraContext = previewChunks.length > 0
    ? `\n\nScraped chunks:\n${previewChunks
      .map((chunk, index) => `${index + 1}. ${chunk.sourceHost} - ${chunk.sourceTitle} [relevance ${chunk.relevance?.toFixed(2)}]\n${chunk.text.slice(0, 640)}`)
      .join('\n\n')}`
    : sources.length > 0
      ? `\n\nScraped sources:\n${sources.map((source, index) => `${index + 1}. ${source.host} - ${source.title}`).join('\n')}`
      : '';

  let res: Response;
  try {
    res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        messages: [
      {
        role: 'system',
        content: JARVIS_SYSTEM_PROMPT,
      },
          {
            role: 'user',
            content: `${basePrompt}${extraContext}`,
          },
        ],
      }),
    });
  } catch {
    return null;
  }

  if (!res.ok) {
    return null;
  }

  const payload = (await res.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) return null;

  return parseJarvisLlmResponse(content);
}

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const bodyState = await parseJsonBody<JarvisRequest>(request);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;
    const mode = body.mode ?? 'assistant';
    const prompt = body.prompt?.trim() ?? '';

    let trades: JarvisTradeInput[] = Array.isArray(body.trades) ? body.trades : [];
    if (trades.length === 0) {
      const db = getDb();
      if (db) {
        const rows = await db.select({
          id: tradesTable.id,
          symbol: tradesTable.symbol,
          date: tradesTable.date,
          direction: tradesTable.direction,
          totalQuantity: tradesTable.totalQuantity,
          netPnl: tradesTable.netPnl,
          notes: tradesTable.notes,
        }).from(tradesTable)
          .where(eq(tradesTable.userId, authState.user.id))
          .orderBy(desc(tradesTable.date))
          .limit(500);
        trades = rows.map((row) => ({
          ...row,
          notes: row.notes ?? undefined,
        }));
      }
    }

    const usingSourcePack = Boolean(body.sourcePackId);
    const hasManualUrls = Array.isArray(body.urls) && body.urls.length > 0;
    if (usingSourcePack && hasManualUrls) {
      return Response.json({ error: 'Provide either sourcePackId or urls, not both.' }, { status: 400 });
    }

    const summary = summarizeTrades(trades);
    const tradeTickers = extractTradeTickers(trades);
    const selectedPack = body.sourcePackId ? getSourcePack(body.sourcePackId) : undefined;
    if (body.sourcePackId && !selectedPack) {
      return Response.json({ error: `Unknown source pack: ${body.sourcePackId}` }, { status: 400 });
    }

    const resolvedPrompt = prompt || selectedPack?.promptTemplate || '';
    const basePrompt = toModePrompt(mode, summary, resolvedPrompt);
    const scrapeUrls = selectedPack ? selectedPack.urls : normalizeScrapeUrls(body.urls);

    await rememberUrls(authState.user, scrapeUrls).catch(() => null);
    const scrapeResult = await scrapeSources(scrapeUrls, tradeTickers);
    const scrapedSources = scrapeResult.sources;
    const sourceSummary = sourceSummaryFor(scrapedSources);
    const sourceContexts = scrapeResult.sourceContexts;
    const llmMessage = await askLlm(basePrompt, scrapedSources, scrapeResult.chunks);

    const warnings = [...scrapeResult.warnings];

    if (llmMessage) {
      return Response.json({
        message: llmMessage.message,
        sourceSummary,
        sources: sourceContexts,
        structured: llmMessage.structured,
        warnings,
      });
    }

    const fallback = [
      basePrompt,
      scrapedSources.length > 0
        ? `\n\nTop context excerpts:\n${sourceContexts
            .map(
              (source) =>
                `- ${source.host}: ${source.title} (relevance ${source.relevance.toFixed(2)})\n${source.excerpt}${source.excerpt.length > CHUNK_CONTEXT_LIMIT ? '...' : ''}`,
            )
            .join('\n\n')}`
        : '',
    ].join('');

    const structuredFallback = buildStructuredFallbackFromSources({
      prompt,
      sourceSummary,
      sources: sourceContexts,
      warnings,
    });

    return Response.json({
      message: fallback,
      sourceSummary,
      sources: sourceContexts,
      structured: structuredFallback,
      warnings,
    });
  } catch (error) {
    logRouteError('jarvis.post', error);
    return internalServerError();
  }
}

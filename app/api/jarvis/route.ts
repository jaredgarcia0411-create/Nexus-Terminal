import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { jarvisSourceUrls, trades as tradesTable } from '@/lib/db/schema';
import { ensureUser, requireUser } from '@/lib/server-db-utils';

type JarvisMode = 'daily-summary' | 'trade-analysis' | 'assistant';

type TradeInput = {
  id: string;
  symbol: string;
  date: string | Date;
  netPnl?: number;
  pnl?: number;
  direction?: 'LONG' | 'SHORT';
  totalQuantity?: number;
  tags?: string[];
};

type JarvisRequest = {
  mode?: JarvisMode;
  prompt?: string;
  url?: string;
  urls?: string[];
  trades?: TradeInput[];
};

const MAX_SCRAPE_URLS = 5;
const MAX_REMEMBERED_URLS = 20;

function asDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatMoney(value: number) {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function summarizeTrades(input: TradeInput[]) {
  const trades = input
    .map((trade) => {
      const date = asDate(trade.date);
      if (!date) return null;
      return {
        ...trade,
        date,
        pnl: Number(trade.netPnl ?? trade.pnl ?? 0),
        qty: Number(trade.totalQuantity ?? 0),
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
    const lines = summary.latestTrades.map((trade) => `- ${trade.symbol} ${trade.direction ?? ''} (${formatMoney(trade.pnl)})`).join('\n');
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

function sanitizeHtml(input: string) {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function scrapeUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return null;
  }

  const res = await fetch(parsed.toString(), {
    headers: { 'User-Agent': 'Nexus-Jarvis/1.0' },
    cache: 'no-store',
  });

  if (!res.ok) {
    return null;
  }

  const html = await res.text();
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1]?.replace(/\s+/g, ' ').trim() ?? parsed.hostname;
  const text = sanitizeHtml(html).slice(0, 2500);

  return {
    title,
    host: parsed.hostname,
    excerpt: text,
  };
}

type ScrapedSource = NonNullable<Awaited<ReturnType<typeof scrapeUrl>>>;

function normalizeScrapeUrls(body: JarvisRequest) {
  const incoming = [
    ...(Array.isArray(body.urls) ? body.urls : []),
    typeof body.url === 'string' ? body.url : '',
  ];

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

function sourceSummaryFor(scrapedSources: ScrapedSource[]) {
  if (scrapedSources.length === 0) return undefined;
  return scrapedSources.map((source) => `${source.title} (${source.host})`).join('; ');
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
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const urls = await loadRememberedUrls(authState.user.id);
  return Response.json({ urls });
}

async function askLlm(basePrompt: string, scrapedSources: ScrapedSource[]) {
  const apiKey = process.env.JARVIS_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.JARVIS_MODEL || 'glm-4.7';
  const baseUrl = process.env.JARVIS_API_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
  const extraContext = scrapedSources.length > 0
    ? `\n\nScraped sources:\n${scrapedSources
        .map((source, index) => `${index + 1}. ${source.host} - ${source.title}\n${source.excerpt}`)
        .join('\n\n')}`
    : '';

  const res = await fetch(baseUrl, {
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
          content: 'You are Jarvis, a focused trading assistant. Be concise, practical, and risk-aware.',
        },
        {
          role: 'user',
          content: `${basePrompt}${extraContext}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    return null;
  }

  const payload = (await res.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return payload.choices?.[0]?.message?.content?.trim() ?? null;
}

export async function POST(request: Request) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const body = (await request.json().catch(() => ({}))) as JarvisRequest;
  const mode = body.mode ?? 'assistant';
  const prompt = body.prompt?.trim() ?? '';

  let trades = Array.isArray(body.trades) ? body.trades : [];
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
      }).from(tradesTable)
        .where(eq(tradesTable.userId, authState.user.id))
        .orderBy(desc(tradesTable.date))
        .limit(500);
      trades = rows;
    }
  }

  const summary = summarizeTrades(trades);
  const basePrompt = toModePrompt(mode, summary, prompt);
  const scrapeUrls = normalizeScrapeUrls(body);
  await rememberUrls(authState.user, scrapeUrls).catch(() => null);
  const scrapedResults = await Promise.all(scrapeUrls.map((url) => scrapeUrl(url)));
  const scrapedSources = scrapedResults.filter((result): result is ScrapedSource => result != null);
  const sourceSummary = sourceSummaryFor(scrapedSources);
  const llmMessage = await askLlm(basePrompt, scrapedSources);

  if (llmMessage) {
    return Response.json({
      message: llmMessage,
      sourceSummary,
    });
  }

  const fallback = [
    basePrompt,
    scrapedSources.length > 0
      ? `\n\nScraped Context:\n${scrapedSources
          .map(
            (source) =>
              `- ${source.host}: ${source.title}\n${source.excerpt.slice(0, 700)}${source.excerpt.length > 700 ? '...' : ''}`,
          )
          .join('\n\n')}`
      : '',
  ].join('');

  return Response.json({
    message: fallback,
    sourceSummary,
  });
}

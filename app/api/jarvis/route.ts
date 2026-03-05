import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { trades as tradesTable } from '@/lib/db/schema';
import { requireUser } from '@/lib/server-db-utils';

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
  trades?: TradeInput[];
};

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

async function askLlm(basePrompt: string, scraped: Awaited<ReturnType<typeof scrapeUrl>>) {
  const apiKey = process.env.JARVIS_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.JARVIS_MODEL || 'glm-4.7';
  const baseUrl = process.env.JARVIS_API_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
  const extraContext = scraped
    ? `\n\nScraped source (${scraped.host} - ${scraped.title}):\n${scraped.excerpt}`
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
  const scraped = body.url ? await scrapeUrl(body.url.trim()) : null;
  const llmMessage = await askLlm(basePrompt, scraped);

  if (llmMessage) {
    return Response.json({
      message: llmMessage,
      sourceSummary: scraped ? `${scraped.title} (${scraped.host})` : undefined,
    });
  }

  const fallback = [
    basePrompt,
    scraped
      ? `\n\nScraped Context (${scraped.host}):\n${scraped.title}\n${scraped.excerpt.slice(0, 700)}${scraped.excerpt.length > 700 ? '...' : ''}`
      : '',
  ].join('');

  return Response.json({
    message: fallback,
    sourceSummary: scraped ? `${scraped.title} (${scraped.host})` : undefined,
  });
}

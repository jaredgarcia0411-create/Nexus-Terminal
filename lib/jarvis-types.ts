export type JarvisMode = 'daily-summary' | 'trade-analysis' | 'assistant';

export interface JarvisTradeInput {
  id: string;
  symbol: string;
  date: string | Date;
  netPnl?: number;
  pnl?: number;
  direction?: 'LONG' | 'SHORT';
  totalQuantity?: number;
  tags?: string[];
  notes?: string;
}

export interface JarvisRequest {
  mode?: JarvisMode;
  prompt?: string;
  urls?: string[];
  sourcePackId?: string;
  trades?: JarvisTradeInput[];
}

export interface JarvisResponse {
  message: string;
  sourceSummary?: string;
  sources?: JarvisSourceContext[];
  warnings?: string[];
  structured?: JarvisStructuredResponse;
}

export interface JarvisStructuredResponse {
  tldr: string;
  findings: string[];
  actionSteps: string[];
  risks: string[];
}

export interface ScrapedChunk {
  sourceUrl: string;
  sourceHost: string;
  sourceTitle: string;
  index: number;
  startToken: number;
  endToken: number;
  tokenCount: number;
  text: string;
  hash: string;
  relevance?: number;
  tickers: string[];
  publishedAt?: string;
  author?: string;
}

export interface JarvisSourceContext {
  url: string;
  title: string;
  host: string;
  excerpt: string;
  relevance: number;
  publishedAt?: string;
  author?: string;
  tickers: string[];
}

export interface ScrapedSource {
  url: string;
  title: string;
  host: string;
  excerpt: string;
  scrapedAt: Date;
  blocked?: boolean;
  error?: string;
  publishedAt?: string;
  author?: string;
  body?: string;
  tickers?: string[];
}

export interface ScrapeResult {
  sources: ScrapedSource[];
  chunks: ScrapedChunk[];
  sourceContexts: JarvisSourceContext[];
  warnings: string[];
}

export function toJarvisTradeInput(trade: {
  id: string;
  symbol: string;
  date: string | Date;
  netPnl?: number;
  pnl?: number;
  direction?: 'LONG' | 'SHORT';
  totalQuantity?: number;
  tags?: string[];
  notes?: string;
}): JarvisTradeInput {
  return {
    id: trade.id,
    symbol: trade.symbol,
    date: trade.date,
    netPnl: trade.netPnl,
    pnl: trade.pnl,
    direction: trade.direction,
    totalQuantity: trade.totalQuantity,
    tags: trade.tags,
    notes: trade.notes,
  };
}

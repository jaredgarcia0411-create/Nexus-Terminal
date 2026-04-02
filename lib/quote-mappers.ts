/**
 * Shared quote mapping utilities used by:
 * - app/api/market-data/snapshot/route.ts
 * - app/api/market-data/stream/route.ts
 * - components/trading/MarketsTab.tsx
 *
 * Centralizes the MarketInstrument/MarketMoverRow types and the logic
 * for converting raw quote data into the standard snapshot shape.
 */

import { INDEX_SYMBOLS, COMMODITY_SYMBOLS, EQUITY_SYMBOLS } from '@/lib/market-symbols';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MarketInstrument = {
  symbol: string;
  label: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  marketStatus: string | null;
  quoteSession: 'pre-market' | 'regular' | 'after-hours' | 'closed' | 'snapshot';
  extendedQuoteUnavailable: boolean;
  extendedUnavailableLabel: string | null;
};

export type MarketMoverRow = {
  ticker: string;
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  updated: number | null;
  volume: number | null;
};

export type MarketSnapshotPayload = {
  indices: MarketInstrument[];
  commodities: MarketInstrument[];
  equities: MarketInstrument[];
  movers: {
    gainers: MarketMoverRow[];
    losers: MarketMoverRow[];
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize a symbol for Map lookups — uppercase, strip slashes (e.g. /ES → ES). */
export function normalizeQuoteSymbol(value: string): string {
  return value.trim().toUpperCase().replace(/\//g, '');
}

// ---------------------------------------------------------------------------
// Schwab screener → MoverRow[]
// ---------------------------------------------------------------------------

/** Shared type for raw Schwab screener items (gainers/losers). */
export type SchwabScreenerItem = {
  symbol?: string;
  lastPrice?: number;
  netChange?: number;
  netChangePercent?: number;
  totalVolume?: number;
};

/** Convert Schwab screener items into the standard MarketMoverRow shape. */
export function schwabScreenerToMoverRows(rows: SchwabScreenerItem[] | undefined): MarketMoverRow[] {
  if (!rows) return [];

  return rows
    .map((row): MarketMoverRow | null => {
      if (!row.symbol || row.symbol.length === 0) return null;
      return {
        ticker: row.symbol,
        price: row.lastPrice ?? null,
        previousClose: null,
        change: row.netChange ?? null,
        changePercent: row.netChangePercent ?? null,
        updated: null,
        volume: row.totalVolume ?? null,
      };
    })
    .filter((row): row is MarketMoverRow => row !== null);
}

// ---------------------------------------------------------------------------
// Quote lookup → indices/commodities/equities snapshot
// ---------------------------------------------------------------------------

/** Minimal quote shape — works with DB rows, relay updates, or any source. */
export type QuoteLike = {
  lastPrice?: number | null;
  netChange?: number | null;
  netChangePercent?: number | null;
  securityStatus?: string | null;
};

/**
 * Build the standard indices/commodities/equities snapshot from a quote lookup.
 * The Map keys should be raw symbols (normalization is handled internally).
 */
export function quotesToSnapshot(
  quoteLookup: Map<string, QuoteLike>,
  quoteSession: MarketInstrument['quoteSession'] = 'regular',
): { indices: MarketInstrument[]; commodities: MarketInstrument[]; equities: MarketInstrument[] } {
  const toInstrument = (symbol: string, label: string): MarketInstrument => {
    const quote = quoteLookup.get(normalizeQuoteSymbol(symbol));
    if (!quote) {
      return {
        symbol, label, price: null, change: null, changePercent: null,
        marketStatus: null, quoteSession: 'snapshot',
        extendedQuoteUnavailable: false, extendedUnavailableLabel: null,
      };
    }

    return {
      symbol, label,
      price: quote.lastPrice ?? null,
      change: quote.netChange ?? null,
      changePercent: quote.netChangePercent ?? null,
      marketStatus: quote.securityStatus ?? null,
      quoteSession,
      extendedQuoteUnavailable: false,
      extendedUnavailableLabel: null,
    };
  };

  return {
    indices: INDEX_SYMBOLS.map((s) => toInstrument(s, s)),
    commodities: COMMODITY_SYMBOLS.map((c) => toInstrument(c.ticker, c.label)),
    equities: EQUITY_SYMBOLS.map((s) => toInstrument(s, s)),
  };
}

import { INDEX_SYMBOLS, COMMODITY_SYMBOLS, EQUITY_SYMBOLS } from '@/lib/market-symbols';
import {
  normalizeQuoteSymbol,
  type MarketInstrument,
  type MarketSnapshotPayload,
} from '@/lib/quote-mappers';
import {
  fetchBatchDailyTickerSummaries,
  fetchTopMarketMovers,
  fetchUnifiedSnapshot,
  getEasternMarketSession,
  normalizeMassiveTicker,
  type EasternMarketSession,
} from '@/lib/massive-market';

const EXTENDED_SESSION_SYMBOLS = [...INDEX_SYMBOLS, ...COMMODITY_SYMBOLS.map((s) => s.ticker), ...EQUITY_SYMBOLS];

export function normalizeTicker(raw: string) {
  return normalizeMassiveTicker(raw);
}

function toNumberOrNull(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function getNyIsoDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function calculateExtendedChange(price: number | null, close: number | null) {
  if (price == null || close == null || close === 0) {
    return { change: null, changePercent: null };
  }
  const change = price - close;
  return {
    change,
    changePercent: (change / close) * 100,
  };
}

function toInstrument(
  ticker: string,
  label: string,
  lookup: Map<string, { session?: Record<string, unknown>; market_status?: string }>,
  activeSession: EasternMarketSession,
  extendedSummaries?: Map<string, { close: number | null; preMarket: number | null; afterHours: number | null }>
): MarketInstrument {
  const symbol = normalizeQuoteSymbol(normalizeTicker(ticker));
  const entry = lookup.get(normalizeTicker(ticker));
  const session = entry?.session ?? {};

  const defaultInstrument: MarketInstrument = {
    symbol,
    label,
    price: toNumberOrNull(session.close),
    change: toNumberOrNull(session.change),
    changePercent: toNumberOrNull(session.change_percent),
    marketStatus: typeof entry?.market_status === 'string' ? entry.market_status : null,
    quoteSession: 'snapshot',
    extendedQuoteUnavailable: false,
    extendedUnavailableLabel: null,
  };

  if (!extendedSummaries) {
    return defaultInstrument;
  }

  const extended = extendedSummaries.get(symbol);
  if (!extended) {
    return defaultInstrument;
  }

  if (activeSession === 'pre-market') {
    if (extended.preMarket != null) {
      const calculated = calculateExtendedChange(extended.preMarket, extended.close);
      return {
        ...defaultInstrument,
        price: extended.preMarket,
        change: calculated.change,
        changePercent: calculated.changePercent,
        quoteSession: 'pre-market',
      };
    }

    return {
      ...defaultInstrument,
      quoteSession: 'pre-market',
      extendedQuoteUnavailable: true,
      extendedUnavailableLabel: 'Pre-market unavailable',
    };
  }

  if (activeSession === 'after-hours' || activeSession === 'closed') {
    if (extended.afterHours != null) {
      const calculated = calculateExtendedChange(extended.afterHours, extended.close);
      return {
        ...defaultInstrument,
        price: extended.afterHours,
        change: calculated.change,
        changePercent: calculated.changePercent,
        quoteSession: 'after-hours',
      };
    }

    if (activeSession === 'after-hours') {
      return {
        ...defaultInstrument,
        quoteSession: 'after-hours',
        extendedQuoteUnavailable: true,
        extendedUnavailableLabel: 'After-hours unavailable',
      };
    }

    return {
      ...defaultInstrument,
      quoteSession: 'closed',
    };
  }

  return {
    ...defaultInstrument,
    quoteSession: 'regular',
  };
}

function toMoverRows(rows: Array<{ ticker?: string; day?: { c?: number }; prevDay?: { c?: number }; todaysChange?: number; todaysChangePerc?: number; updated?: number }>) {
  return rows
    .map((row) => ({
      ticker: row.ticker ?? '',
      price: toNumberOrNull(row.day?.c),
      previousClose: toNumberOrNull(row.prevDay?.c),
      change: toNumberOrNull(row.todaysChange),
      changePercent: toNumberOrNull(row.todaysChangePerc),
      updated: toNumberOrNull(row.updated),
      volume: null,
    }))
    .filter((row) => row.ticker.length > 0)
    .filter((row) => (row.previousClose ?? 0) >= 0.75);
}

export async function fetchFreshSnapshot(): Promise<MarketSnapshotPayload> {
  const tickers = [
    ...INDEX_SYMBOLS,
    ...COMMODITY_SYMBOLS.map((item) => item.ticker),
    ...EQUITY_SYMBOLS,
  ];

  const activeSession = getEasternMarketSession();
  const [snapshot, gainers, losers, extendedSummaries] = await Promise.all([
    fetchUnifiedSnapshot(tickers),
    fetchTopMarketMovers('gainers'),
    fetchTopMarketMovers('losers'),
    fetchBatchDailyTickerSummaries(EXTENDED_SESSION_SYMBOLS, getNyIsoDate()),
  ]);

  const lookup = new Map<string, { session?: Record<string, unknown>; market_status?: string }>();
  for (const row of snapshot.results ?? []) {
    const ticker = typeof row.ticker === 'string' ? row.ticker : '';
    if (!ticker) continue;
    lookup.set(normalizeTicker(ticker), {
      session: (row.session ?? {}) as Record<string, unknown>,
      market_status: row.market_status,
    });
  }

  return {
    indices: INDEX_SYMBOLS.map((symbol) => toInstrument(symbol, symbol, lookup, activeSession, extendedSummaries)),
    commodities: COMMODITY_SYMBOLS.map((item) => toInstrument(item.ticker, item.label, lookup, activeSession, extendedSummaries)),
    equities: EQUITY_SYMBOLS.map((symbol) => toInstrument(symbol, symbol, lookup, activeSession, extendedSummaries)),
    movers: {
      gainers: toMoverRows(gainers.tickers ?? []),
      losers: toMoverRows(losers.tickers ?? []),
    },
  };
}

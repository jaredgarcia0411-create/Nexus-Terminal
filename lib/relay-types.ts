/**
 * Quote data broadcast by the Schwab relay WebSocket.
 * Matches the shape of QuoteUpdate in services/schwab-relay/src/streamer.ts.
 */
export type RelayQuoteUpdate = {
  symbol: string;
  assetType: string;
  lastPrice?: number;
  bidPrice?: number;
  askPrice?: number;
  openPrice?: number;
  highPrice?: number;
  lowPrice?: number;
  closePrice?: number;
  netChange?: number;
  netChangePercent?: number;
  totalVolume?: number;
  exchangeId?: string;
  securityStatus?: string;
  quoteTimeMs?: number;
};

/**
 * Screener data broadcast by the relay.
 * Contains merged gainers + losers (relay sends full screener state each time).
 */
export type RelayScreenerData = {
  gainers: RelayScreenerItem[];
  losers: RelayScreenerItem[];
};

export type RelayScreenerItem = {
  symbol: string;
  lastPrice: number;
  netChange: number;
  netChangePercent: number;
  totalVolume: number;
};

/**
 * Message types sent by the relay WebSocket.
 *
 * - snapshot: Full quote array, sent once on connect
 * - quotes: Incremental quote updates, sent on each Schwab tick
 * - screener: Full screener state (gainers + losers)
 */
export type RelayMessage =
  | { type: 'snapshot'; data: RelayQuoteUpdate[] }
  | { type: 'quotes'; data: RelayQuoteUpdate[] }
  | { type: 'screener'; data: RelayScreenerData };

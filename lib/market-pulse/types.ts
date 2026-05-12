export interface MarketPulseBar {
  tradeDate: string;
  ticker: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number | null;
  dollarVolume: number;
  sourceTimestamp: Date | null;
  sector?: string | null;
  industry?: string | null;
  country?: string | null;
  floatShares?: number | null;
  marketCap?: number | null;
  perf30d?: number | null;
}

export interface MarketPulseLeader {
  ticker: string;
  changePct: number;
  volume: number;
  dollarVolume: number;
  sector?: string | null;
}

export interface MarketPulseRolling30 {
  tradingDays: number;
  avgAdvancerPct: number | null;
  medianAdvancerPct: number | null;
  strongDays: number;
  weakDays: number;
  newHigh30dAvg: number | null;
  newLow30dAvg: number | null;
}

export interface MarketPulseOverview90 {
  tradingDays: number;
  trend: 'improving' | 'flat' | 'deteriorating';
  strongestDate: string | null;
  weakestDate: string | null;
  note: string;
}

export interface MarketPulseDailyStats {
  tradeDate: string;
  tickerCount: number;
  advancers: number;
  decliners: number;
  unchanged: number;
  advancerPct: number;
  declinerPct: number;
  upVolume: number;
  downVolume: number;
  totalVolume: number;
  medianChangePct: number | null;
  avgChangePct: number | null;
  pctAbovePrevClose: number | null;
  pctAboveDollarVolumeFloor: number | null;
  newHigh30dCount: number;
  newLow30dCount: number;
  rolling30: MarketPulseRolling30;
  overview90: MarketPulseOverview90 | null;
  leaders: MarketPulseLeader[];
  laggards: MarketPulseLeader[];
}

export interface MarketPulseCaptureResult {
  tradeDate: string;
  skipped: boolean;
  barsUpserted: number;
  statsUpserted: number;
  stats: MarketPulseDailyStats | null;
}

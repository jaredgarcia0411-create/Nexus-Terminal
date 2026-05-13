export type Direction = 'LONG' | 'SHORT';

export interface Execution {
  id: string;
  side: 'ENTRY' | 'EXIT';
  price: number;
  qty: number;
  time: string;
  timestamp?: Date | string;
  commission: number;
  fees: number;
}

export interface Trade {
  id: string;
  date: Date;
  sortKey: string; // YYYY-MM-DD
  symbol: string;
  direction: Direction;
  avgEntryPrice: number;
  avgExitPrice: number;
  totalQuantity: number;
  grossPnl: number;
  netPnl: number;
  entryTime: string;
  exitTime: string;
  executionCount: number;
  rawExecutions: Execution[];
  // DB-compat aliases — always mirrored from netPnl/executionCount by normalizeTrade().
  // Use netPnl and executionCount in all new code.
  pnl: number;
  executions: number;
  mfe?: number;
  mae?: number;
  bestExitPnl?: number;
  exitEfficiency?: number;
  initialRisk?: number; // Initial risk in $
  commission?: number;
  fees?: number;
  tags: string[];
  notes?: string;
}

/**
 * Wire format of a trade returned by / sent to API routes.
 * Identical to Trade except `date` is an ISO string (JSON has no Date type).
 */
export type ApiTrade = {
  id: string;
  date: string;
  sortKey: string;
  symbol: string;
  direction: Direction;
  avgEntryPrice: number;
  avgExitPrice: number;
  totalQuantity: number;
  grossPnl: number;
  netPnl: number;
  entryTime: string;
  exitTime: string;
  executionCount: number;
  rawExecutions: Execution[];
  mfe?: number;
  mae?: number;
  bestExitPnl?: number;
  exitEfficiency?: number;
  pnl: number;
  executions: number;
  initialRisk?: number;
  commission?: number;
  fees?: number;
  tags: string[];
  notes?: string;
};

export interface TradeMarker {
  time: number;
  direction: 'LONG' | 'SHORT';
  price: number;
  label: string;
}

export type BacktestActionType = 'LONG' | 'LONG_ADD' | 'SELL' | 'SHORT' | 'SHORT_ADD' | 'COVER';
export type BacktestSessionStatus = 'ACTIVE' | 'REVIEWED';

export interface BacktestChartState {
  drawings?: unknown[];
  indicators?: Record<string, string[]>;
}

export interface BacktestSession {
  id: string;
  userId: string;
  ticker: string;
  date: string;
  status: BacktestSessionStatus;
  riskDollars: number;
  label: string | null;
  notes: string | null;
  chartState: BacktestChartState | null;
  backtestId: string | null;
  reviewedAt: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface BacktestAction {
  id: string;
  userId: string;
  sessionId: string;
  actionType: BacktestActionType;
  price: number;
  shares: number;
  stopPrice: number | null;
  barTime: string;
  sequence: number;
  createdAt: string | Date;
}

// Normalized server-side shape returned by /api/askedgar/snapshot.
// All field resolution (snake_case/camelCase, equity dedup, warrant classification)
// is done server-side in normalizeAskEdgarResponse().

export interface ResearchSnapshotHeader {
  marketCap: number | null;
  outstandingShares: number | null;
  float: number | null;
  exchange: string | null;
  ipoDate: string | null;
  industry: string | null;
  country: string | null;
  price: number | null;
  shortInterest: number | null;
  volume: number | null;
  description: string | null;
}

export interface ResearchSnapshotWarrant {
  details: string;
  amount: number | null;
  remaining: number | null;
  exercisePrice: number | null;
  prefundedCost: number | null;
  registered: string | null;
  exercisableDate: string | null;
  expirationDate: string | null;
  filedAt: string | null;
  isPrefunded: boolean;
  status: string | null;
}

export interface ResearchSnapshotRegistration {
  headline: string;
  filedAt: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  isEffective: boolean;
  offeringAmount: number | null;
  isAtm: boolean;
  bank: string | null;
  amountRemainingAtm: number | null;
  totalRaised: number | null;
  overBabyShelf: boolean;
  babyShelfRaisableAmount: number | null;
  formType: string | null;
  status: string | null;
}

export interface ResearchSnapshotOffering {
  headline: string;
  filedAt: string | null;
  offeringType: string | null;
  sharesAmount: number | null;
  warrantsAmount: number | null;
  sharePrice: number | null;
  offeringAmount: number | null;
}

export interface ResearchSnapshotNewsItem {
  title: string;
  summary: string;
  filedAt: string | null;
  formType: string | null;
  isNews: boolean;
}

export type FilingBucket =
  | 'financials'
  | 'news'
  | 'registrations'
  | 'prospectus'
  | 'proxies'
  | 'ownerships'
  | 'other';

export interface ResearchSnapshotFiling {
  formType: string;
  bucket: FilingBucket;
  title: string;
  filedAt: string | null;
  url: string | null;
  accessionNumber: string | null;
}

export interface ResearchSnapshotDilutionDetails {
  cashRemainingMonths: number | null;
  cashBurn: number | null;
  estimatedCash: number | null;
  managementCommentary: string | null;
  cashNeedDescription: string | null;
  filedAt: string | null;
  warrantInfo: string | null;
  convertibles: string | null;
  authorizedShares: number | null;
  sharesAvailable: number | null;
}

export interface ResearchSnapshotConvertibleNote {
  details: string;
  principalAmount: number | null;
  conversionPrice: number | null;
  maturityDate: string | null;
  filedAt: string | null;
  status: string | null;
}

export interface ResearchSnapshotOwner {
  name: string;
  role: string;
  common: number | null;
  preferred: number | null;
  options: number | null;
  warrants: number | null;
}

export interface ResearchSnapshotOwnershipGroup {
  reportedDate: string | null;
  owners: ResearchSnapshotOwner[];
}

export interface ResearchSnapshotHistoricalFloatRow {
  date: string | null;
  outstanding: number | null;
  float: number | null;
  tradableFloat: number | null;
}

export interface ResearchSnapshotReverseSplit {
  date: string | null;
  ratio: string | null;
}

export interface ResearchSnapshotSplitStatus {
  actionType: string | null;
  splitFrom: number | null;
  splitTo: number | null;
  voteDate: string | null;
  approvedDate: string | null;
  effectiveDate: string | null;
  details: string | null;
  filedAt: string | null;
  formType: string | null;
  documentUrl: string | null;
  lastUpdated: string | null;
}

export interface ResearchSnapshotAgreement {
  type: string | null;
  investor: string | null;
  date: string | null;
  details: string | null;
}

export interface ResearchSnapshotGapStat {
  date: string | null;
  gapPercentage: number | null;
  marketOpen: number | null;
  marketClose: number | null;
  intradayHigh: number | null;
  intradayLow: number | null;
  volume: number | null;
  tags: string[];
}

// Client-safe shape — sent to the browser via /api/askedgar/snapshot.
// Does NOT include rawData (full per-endpoint payload). That lives in ResearchSnapshotFull.
export interface ResearchSnapshot {
  ticker: string;
  fetchedAt: string;
  companyName: string | null;
  warnings: string[];
  header: ResearchSnapshotHeader;
  dilutionRating: string | null;
  cashNeedRating: string | null;
  offeringFrequencyRating: string | null;
  offeringAbilityRating: string | null;
  warrantExerciseRating: string | null;
  overallRisk: string | null;
  regsho: boolean;
  nasdaqCompliance: string | null;
  dilutionDetails: ResearchSnapshotDilutionDetails;
  warrants: ResearchSnapshotWarrant[];
  convertibleNotes: ResearchSnapshotConvertibleNote[];
  registrations: ResearchSnapshotRegistration[];
  equityLines: ResearchSnapshotRegistration[];
  offerings: ResearchSnapshotOffering[];
  news: ResearchSnapshotNewsItem[];
  filings: ResearchSnapshotFiling[];
  ownershipGroups: ResearchSnapshotOwnershipGroup[];
  historicalFloat: ResearchSnapshotHistoricalFloatRow[];
  reverseSplits: ResearchSnapshotReverseSplit[];
  splitStatuses: ResearchSnapshotSplitStatus[];
  agreements: ResearchSnapshotAgreement[];
  gapStats: ResearchSnapshotGapStat[];
}

// Server-side full shape — includes the raw per-endpoint API payloads used by
// the LLM research pipeline (lib/research.ts). Never sent to the browser.
export interface ResearchSnapshotFull extends ResearchSnapshot {
  // Raw AskEdgar/SEC payload keyed by endpoint.
  rawData: Record<string, { status: string; results: unknown[]; error?: string }>;
}

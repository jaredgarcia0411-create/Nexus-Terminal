export interface DilutionDataSourceCheck {
  endpoint: string;
  label: string;
  hasData: boolean;
  error?: string;
}

export interface AskEdgarResponse<T> {
  status: string;
  count: number;
  results: T[];
  error?: string;
  usage?: { cost_microdollars?: number };
}

export interface TickerDataResult {
  ticker: string;
  fetchedAt: string;
  rawData: Record<string, AskEdgarResponse<unknown>>;
  // ISO timestamps for the last successful fetch of each endpoint. Used so
  // /v1/news can carry its own 15-minute freshness window while the rest of the
  // ticker row keeps the 16-hour TTL.
  endpointFetchedAt: Record<string, string>;
  dataSources: DilutionDataSourceCheck[];
  warnings: string[];
  hasAnyData: boolean;
  cacheExpiresAt?: string;
}

export interface AskEdgarSnapshotAvailability {
  hasAnyData: boolean;
  hasUsableSnapshotData: boolean;
  failureKind: 'rate-limited' | 'upstream-unavailable' | null;
  retryAfterSeconds: number | null;
}

export interface NormalizeAskEdgarOptions {
  ticker: string;
  companyName: string | null;
  fetchedAt: string;
  warnings: string[];
  description?: string | null;
}

export interface ScannerSummaryResult {
  ticker: string;
  cashRemainingMonths: number | null;
  hasAtm: boolean;
  hasEl: boolean;
  hasWarrants: boolean;
  hasS1: boolean;
  fetchedAt: string;
}

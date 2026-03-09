export interface AskEdgarResponse<T> {
  status: string;
  count: number;
  results: T[];
  error?: string;
}

export interface FloatOutstandingResult {
  ticker: string;
  float: number | null;
  outstanding: number | null;
  market_cap_final?: number | null;
  industry?: string;
  sector?: string;
  country?: string;
  isadr?: boolean;
  insider_percent?: number | null;
  affiliate_percent?: number | null;
  institutions_percent?: number | null;
}

export interface ScreenerResult {
  ticker: string;
  market_cap?: number | null;
  price?: number | null;
  averagevolume?: number | null;
  today_volume?: number | null;
  short_float?: number | null;
  short_interest?: number | null;
  feerate?: number | null;
  gain_1_day?: number | null;
  gain_7_day?: number | null;
  gain_30_day?: number | null;
}

export interface DilutionRatingResult {
  ticker: string;
  offering_ability?: 'High' | 'Medium' | 'Low' | '';
  offering_ability_desc?: string;
  dilution?: 'High' | 'Medium' | 'Low' | '';
  dilution_desc?: string;
  offering_frequency?: 'High' | 'Medium' | 'Low' | '';
  offering_frequency_desc?: string;
  cash_need?: 'High' | 'Medium' | 'Low' | '';
  cash_need_desc?: string;
  nasdaq_compliance?: 'High' | 'Medium' | 'Low' | '';
  nasdaq_compliance_desc?: string;
  mgmt_commentary?: string;
  overall_offering_risk?: 'High' | 'Medium' | 'Low' | '';
  regsho?: boolean;
  warrant_exercise?: 'High' | 'Medium' | 'Low' | '';
  warrant_exercise_desc?: string;
  estimated_cash?: number | null;
  cash_burn?: number | null;
  cash_remaining_months?: number | null;
  total_debt_final?: number | null;
}

export interface DilutionDataResult {
  details?: string;
  warrants_amount?: number | null;
  warrants_remaining?: number | null;
  warrants_exercise_price?: number | null;
  registered?: string;
  prefunded_cost?: number | null;
  exercisable_date?: string;
  expiration_date?: string;
  filed_at?: string;
  conversion_price?: number | null;
  convertible_date?: string;
  maturity_date?: string;
  offering_amount?: number | null;
  convertible_debt_remaining?: number | null;
  underlying_shares_remaining?: number | null;
}

export interface OfferingResult {
  headline?: string;
  filed_at?: string;
  form_type?: string;
  offering_type?: string;
  shares_amount?: number | null;
  warrants_amount?: number | null;
  share_price?: number | null;
  offering_amount?: number | null;
  conversion_price?: number | null;
}

export interface RegistrationResult {
  headline?: string;
  filed_at?: string;
  effective_date?: string;
  effective_status?: boolean;
  expiration_date?: string;
  offering_amount?: number | null;
  is_atm?: boolean;
  bank?: string;
  amount_remaining_atm?: number | null;
  total_raised?: number | null;
  over_baby_shelf?: boolean;
}

export interface NewsResult {
  ticker?: string;
  filed_at?: string;
  created_at?: string;
  form_type?: string;
  summary?: string;
  body?: string;
  tags?: string[];
  title?: string;
  author?: string;
  document_url?: string;
}

export interface NasdaqComplianceResult {
  ticker?: string;
  date?: string;
  deficiency?: string;
  risk?: string;
  notes?: string;
  status?: string;
}

export interface PumpAndDumpResult {
  ticker?: string;
  ipo_date?: string;
  lock_up_expiration?: string;
  underwriters?: string;
  number_liquidations?: number;
  last_liquidation_date?: string;
  country_risk?: 'high' | 'medium' | 'low' | '';
  float_risk?: 'high' | 'medium' | 'low' | '';
  underwriter_risk?: 'high' | 'medium' | 'low' | '';
  scam_risk?: 'high' | 'medium' | 'low' | '';
  scam_description?: string;
  liquidation_history?: string;
}

export interface AgreementResult {
  agreement_type?: string;
  investor_names?: string;
  filed_at?: string;
  registration_deadline?: number | null;
  effective_deadline?: number | null;
  penalties?: string;
  restriction_date?: string;
  duration_in_days?: number | null;
  participation_percentage?: string;
  details?: string;
}

export interface HistoricalFloatResult {
  reported_date?: string;
  outstanding_shares?: number | null;
  float?: number | null;
  tradable_float?: number | null;
  affiliate_percent?: number | null;
  insider_percent?: number | null;
  institutions_percent?: number | null;
  form_type?: string;
}

export interface ReverseSplitResult {
  execution_date?: string;
  split_from?: number;
  split_to?: number;
}

const ASKEDGAR_BASE_URL = 'https://eapi.askedgar.io';
const DEFAULT_DAILY_LIMIT = 100;
const REQUEST_TIMEOUT_MS = 15_000;
const TICKER_REGEX = /^[A-Z0-9.\-^]+$/;

let callCount = 0;
let resetDate = '';

function getCurrentUtcDate() {
  return new Date().toISOString().slice(0, 10);
}

function resetCounterIfNeeded() {
  const currentDate = getCurrentUtcDate();
  if (resetDate !== currentDate) {
    resetDate = currentDate;
    callCount = 0;
  }
}

function getApiKey() {
  return process.env.ASKEDGAR_API_KEY?.trim() ?? '';
}

function toErrorResponse<T>(error: string): AskEdgarResponse<T> {
  return {
    status: 'error',
    count: 0,
    results: [],
    error,
  };
}

function parseDailyLimit() {
  const configured = Number.parseInt(process.env.ASKEDGAR_DAILY_LIMIT ?? '', 10);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return DEFAULT_DAILY_LIMIT;
}

function ensureTicker(ticker: string): string | null {
  if (!ticker || !TICKER_REGEX.test(ticker)) {
    return null;
  }
  return ticker;
}

function toErrorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object') {
    const rec = payload as Record<string, unknown>;
    const error = rec.error;
    if (typeof error === 'string') {
      return `${status} ${error}`;
    }
    if (error && typeof error === 'object') {
      const nested = error as Record<string, unknown>;
      if (typeof nested.message === 'string') {
        return `${status} ${nested.message}`;
      }
    }
  }
  return `${status} Request failed`;
}

async function requestAskEdgar<T>(path: string, query: Record<string, string | number | boolean | undefined>): Promise<AskEdgarResponse<T>> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return toErrorResponse<T>('ASKEDGAR_API_KEY not configured');
  }

  resetCounterIfNeeded();
  const dailyLimit = parseDailyLimit();
  if (callCount >= dailyLimit) {
    return toErrorResponse<T>(`AskEdgar daily limit reached (${dailyLimit})`);
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.set(key, String(value));
  }

  callCount += 1;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${ASKEDGAR_BASE_URL}${path}?${params.toString()}`, {
      method: 'GET',
      headers: {
        'API-KEY': apiKey,
      },
      signal: controller.signal,
      cache: 'no-store',
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return toErrorResponse<T>(toErrorMessage(payload, response.status));
    }

    if (!payload || typeof payload !== 'object') {
      return toErrorResponse<T>('Invalid AskEdgar response payload');
    }

    const normalized = payload as Record<string, unknown>;
    const results = Array.isArray(normalized.results) ? normalized.results as T[] : [];

    return {
      status: typeof normalized.status === 'string' ? normalized.status : 'success',
      count: Number.isFinite(normalized.count) ? Number(normalized.count) : results.length,
      results,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return toErrorResponse<T>(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    const message = error instanceof Error ? error.message : 'Unknown request error';
    return toErrorResponse<T>(message);
  } finally {
    clearTimeout(timeoutId);
  }
}

function validateTickerOrError<T>(ticker: string): string | AskEdgarResponse<T> {
  const normalized = ensureTicker(ticker);
  if (!normalized) {
    return toErrorResponse<T>('Invalid ticker format');
  }
  return normalized;
}

export function getAskEdgarCallCount() {
  resetCounterIfNeeded();
  return callCount;
}

export function getAskEdgarDailyLimit() {
  return parseDailyLimit();
}

export async function fetchFloatOutstanding(ticker: string): Promise<AskEdgarResponse<FloatOutstandingResult>> {
  const validated = validateTickerOrError<FloatOutstandingResult>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<FloatOutstandingResult>('/v1/float-outstanding', { ticker: validated });
}

export async function fetchScreenerByTicker(ticker: string): Promise<AskEdgarResponse<ScreenerResult>> {
  const validated = validateTickerOrError<ScreenerResult>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<ScreenerResult>('/v1/screener', { ticker: validated });
}

export async function fetchDilutionRating(ticker: string): Promise<AskEdgarResponse<DilutionRatingResult>> {
  const validated = validateTickerOrError<DilutionRatingResult>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<DilutionRatingResult>('/v1/dilution-rating', { ticker: validated });
}

export async function fetchDilutionData(ticker: string): Promise<AskEdgarResponse<DilutionDataResult>> {
  const validated = validateTickerOrError<DilutionDataResult>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<DilutionDataResult>('/v1/dilution-data', { ticker: validated });
}

export async function fetchOfferings(ticker: string, limit = 20): Promise<AskEdgarResponse<OfferingResult>> {
  const validated = validateTickerOrError<OfferingResult>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<OfferingResult>('/v1/offerings', { ticker: validated, limit });
}

export async function fetchRegistrations(ticker: string): Promise<AskEdgarResponse<RegistrationResult>> {
  const validated = validateTickerOrError<RegistrationResult>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<RegistrationResult>('/v1/registrations', { ticker: validated, effective_status: true });
}

export async function fetchNews(ticker: string, limit = 20): Promise<AskEdgarResponse<NewsResult>> {
  const validated = validateTickerOrError<NewsResult>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<NewsResult>('/v1/news', { ticker: validated, limit });
}

export async function fetchNasdaqCompliance(ticker: string): Promise<AskEdgarResponse<NasdaqComplianceResult>> {
  const validated = validateTickerOrError<NasdaqComplianceResult>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<NasdaqComplianceResult>('/v1/nasdaq-compliance', { ticker: validated });
}

export async function fetchPumpAndDumpTracker(ticker: string): Promise<AskEdgarResponse<PumpAndDumpResult>> {
  const validated = validateTickerOrError<PumpAndDumpResult>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<PumpAndDumpResult>('/v1/pump-and-dump-tracker', { ticker: validated });
}

export async function fetchAgreements(ticker: string): Promise<AskEdgarResponse<AgreementResult>> {
  const validated = validateTickerOrError<AgreementResult>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<AgreementResult>('/v1/agreements', { ticker: validated });
}

export async function fetchHistoricalFloatPro(ticker: string, limit = 20): Promise<AskEdgarResponse<HistoricalFloatResult>> {
  const validated = validateTickerOrError<HistoricalFloatResult>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<HistoricalFloatResult>('/v1/historical-float-pro', { ticker: validated, limit });
}

export async function fetchReverseSplits(ticker: string): Promise<AskEdgarResponse<ReverseSplitResult>> {
  const validated = validateTickerOrError<ReverseSplitResult>(ticker);
  if (typeof validated !== 'string') return validated;
  return requestAskEdgar<ReverseSplitResult>('/v1/reverse-splits', { ticker: validated });
}

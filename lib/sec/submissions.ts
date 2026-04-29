import { secFetchJson, SecHttpError } from '@/lib/sec/client';
import { getCikForTicker, padCik } from '@/lib/sec/cik-map';

const SUBMISSIONS_BASE = 'https://data.sec.gov/submissions';
const DEFAULT_LIMIT = 20;
const DEFAULT_SINCE_DAYS = 90;

export interface SecFiling {
  accession_number: string;
  form_type: string;
  filed_at: string;              // 'YYYY-MM-DD'
  headline: string;              // primary_doc_description if present, else `${form_type} filing`
  url: string;                   // archives URL to primary document
  primary_doc_description: string | null;
  items: string | null;
}

// Matches the AskEdgarResponse<T> shape so the result slots into ENDPOINT_REGISTRY
// without changing the runner contract.
export interface SubmissionsResponse {
  status: 'success' | 'error';
  count: number;
  results: SecFiling[];
  error?: string;
}

interface RawSubmissionsPayload {
  cik: string;
  filings?: {
    recent?: {
      accessionNumber?: string[];
      filingDate?: string[];
      form?: string[];
      items?: string[];
      primaryDocument?: string[];
      primaryDocDescription?: string[];
      acceptanceDateTime?: string[];
    };
  };
}

export interface GetRecentFilingsOptions {
  limit?: number;           // default 20
  sinceDays?: number;       // default 90; pass 0 to disable the recency filter
}

function buildFilingUrl(cikUnpadded: string, accession: string, primaryDocument: string): string {
  const accessionNoDashes = accession.replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/${cikUnpadded}/${accessionNoDashes}/${primaryDocument}`;
}

function zipRecent(payload: RawSubmissionsPayload): SecFiling[] {
  const recent = payload.filings?.recent;
  if (!recent || !Array.isArray(recent.accessionNumber)) return [];

  const cikUnpadded = String(parseInt(payload.cik, 10));    // strip leading zeros for URL
  const out: SecFiling[] = [];
  const len = recent.accessionNumber.length;

  for (let i = 0; i < len; i++) {
    const accession = recent.accessionNumber[i];
    const formType = recent.form?.[i] ?? 'unknown';
    const items = recent.items?.[i] ?? null;
    const filedAt = recent.filingDate?.[i] ?? '';
    const primaryDocument = recent.primaryDocument?.[i] ?? '';
    const description = recent.primaryDocDescription?.[i] ?? '';

    if (!accession || !filedAt) continue;

    const headline = description.trim() || `${formType} filing`;

    out.push({
      accession_number: accession,
      form_type: formType,
      filed_at: filedAt,
      headline,
      url: primaryDocument ? buildFilingUrl(cikUnpadded, accession, primaryDocument) : '',
      primary_doc_description: description.trim() || null,
      items,
    });
  }

  return out;
}

function filterAndLimit(filings: SecFiling[], opts: Required<GetRecentFilingsOptions>): SecFiling[] {
  const sinceMs = opts.sinceDays > 0 ? Date.now() - opts.sinceDays * 86400000 : 0;

  const filtered = sinceMs === 0
    ? filings
    : filings.filter((f) => {
        const ts = new Date(f.filed_at).getTime();
        return Number.isFinite(ts) ? ts >= sinceMs : true;
      });

  // SEC submissions JSON returns recent filings already in newest-first order, but
  // sort defensively in case ordering changes upstream.
  filtered.sort((a, b) => (b.filed_at < a.filed_at ? -1 : b.filed_at > a.filed_at ? 1 : 0));

  return filtered.slice(0, opts.limit);
}

export async function getRecentFilings(
  rawTicker: string,
  options: GetRecentFilingsOptions = {},
): Promise<SubmissionsResponse> {
  const opts: Required<GetRecentFilingsOptions> = {
    limit: options.limit ?? DEFAULT_LIMIT,
    sinceDays: options.sinceDays ?? DEFAULT_SINCE_DAYS,
  };

  let cikEntry;
  try {
    cikEntry = await getCikForTicker(rawTicker);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CIK lookup failed';
    console.warn(`[sec-submissions] cik lookup failed for ${rawTicker}: ${message}`);
    return { status: 'error', count: 0, results: [], error: message };
  }

  if (!cikEntry) {
    console.warn(`[sec-submissions] no CIK for ticker ${rawTicker}`);
    return { status: 'success', count: 0, results: [] };
  }

  const url = `${SUBMISSIONS_BASE}/CIK${padCik(cikEntry.cik)}.json`;

  try {
    const payload = await secFetchJson<RawSubmissionsPayload>(url);
    const all = zipRecent(payload);
    const results = filterAndLimit(all, opts);
    return { status: 'success', count: results.length, results };
  } catch (error) {
    const message = error instanceof Error
      ? `${error instanceof SecHttpError ? `SEC ${error.status}` : 'SEC request failed'}: ${error.message}`
      : 'SEC request failed';
    console.warn(`[sec-submissions] fetch failed for ${rawTicker}: ${message}`);
    return { status: 'error', count: 0, results: [], error: message };
  }
}

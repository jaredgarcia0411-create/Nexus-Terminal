import { sql } from 'drizzle-orm';

import { getDb } from '@/lib/db';
import { secFilingsRaw } from '@/lib/db/schema';
import { secFetchJson, SecHttpError } from '@/lib/sec/client';
import { getCikForTicker, normalizeTicker, padCik } from '@/lib/sec/cik-map';
import { summarizeFilingMetadata } from '@/lib/sec/filing-summary';

const SUBMISSIONS_BASE = 'https://data.sec.gov/submissions';
const DEFAULT_LIMIT = 20;
const DEFAULT_SINCE_DAYS = 90;
const DAYS_PER_YEAR = 365;

export type SecFilingPullProfile =
  | 'research-filings'
  | 'completed-offerings'
  | 'reverse-splits'
  | 'symbol-changes';

export interface SecFiling {
  accession_number: string;
  cik: string;
  ticker_requested: string;
  ticker_at_ingest: string | null;
  form_type: string;
  filed_at: string;              // 'YYYY-MM-DD'
  report_date: string | null;
  acceptance_datetime: string | null;
  headline: string;              // deterministic parsed label from form type + 8-K items; falls back to primary_doc_description or "${form_type} filing"
  url: string;                   // archives URL to primary document
  primary_document: string | null;
  primary_doc_description: string | null;
  items: string | null;
  archive_source: string | null;
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
    recent?: RawFilingColumns;
    files?: RawArchiveFile[];
  };
}

export interface GetRecentFilingsOptions {
  limit?: number;           // default 20
  sinceDays?: number;       // default 90; pass 0 to disable the recency filter
  includeArchives?: boolean;
  persistRaw?: boolean;
}

export interface SecFilingPullProfileConfig {
  limit: number;
  sinceDays: number;
  parseCandidateLimit: number;
  metadataOnly: boolean;
}

interface RawArchiveFile {
  name?: string;
  filingCount?: number;
  filingFrom?: string;
  filingTo?: string;
}

interface RawArchivePayload {
  accessionNumber?: string[];
  filingDate?: string[];
  reportDate?: string[];
  acceptanceDateTime?: string[];
  form?: string[];
  items?: string[];
  primaryDocument?: string[];
  primaryDocDescription?: string[];
}

type RawFilingColumns = RawArchivePayload;

const SEC_FILING_PULL_PROFILES: Record<SecFilingPullProfile, SecFilingPullProfileConfig> = {
  'research-filings': {
    limit: 300,
    sinceDays: DAYS_PER_YEAR * 2,
    parseCandidateLimit: 0,
    metadataOnly: true,
  },
  'completed-offerings': {
    limit: 5000,
    sinceDays: DAYS_PER_YEAR * 10,
    parseCandidateLimit: 300,
    metadataOnly: false,
  },
  'reverse-splits': {
    limit: 5000,
    sinceDays: DAYS_PER_YEAR * 10,
    parseCandidateLimit: 200,
    metadataOnly: false,
  },
  'symbol-changes': {
    limit: 5000,
    sinceDays: DAYS_PER_YEAR * 10,
    parseCandidateLimit: 200,
    metadataOnly: false,
  },
};

export function getSecFilingPullProfileConfig(profile: SecFilingPullProfile): SecFilingPullProfileConfig {
  return SEC_FILING_PULL_PROFILES[profile];
}

function buildFilingUrl(cikUnpadded: string, accession: string, primaryDocument: string): string {
  const accessionNoDashes = accession.replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/${cikUnpadded}/${accessionNoDashes}/${primaryDocument}`;
}

function zipFilingColumns(args: {
  columns: RawFilingColumns | undefined;
  cik: string;
  tickerRequested: string;
  tickerAtIngest: string | null;
  archiveSource: string | null;
}): SecFiling[] {
  const { columns, cik, tickerRequested, tickerAtIngest, archiveSource } = args;
  if (!columns || !Array.isArray(columns.accessionNumber)) return [];

  const cikUnpadded = String(parseInt(cik, 10));    // strip leading zeros for URL
  const out: SecFiling[] = [];
  const len = columns.accessionNumber.length;

  for (let i = 0; i < len; i++) {
    const accession = columns.accessionNumber[i];
    const formType = columns.form?.[i] ?? 'unknown';
    const items = columns.items?.[i]?.trim() || null;
    const filedAt = columns.filingDate?.[i] ?? '';
    const reportDate = columns.reportDate?.[i]?.trim() || null;
    const acceptanceDateTime = columns.acceptanceDateTime?.[i]?.trim() || null;
    const primaryDocument = columns.primaryDocument?.[i] ?? '';
    const description = columns.primaryDocDescription?.[i] ?? '';

    if (!accession || !filedAt) continue;

    const headline = summarizeFilingMetadata({
      formType,
      items,
      primaryDocDescription: description.trim() || null,
    });

    out.push({
      accession_number: accession,
      cik: padCik(cik),
      ticker_requested: tickerRequested,
      ticker_at_ingest: tickerAtIngest,
      form_type: formType,
      filed_at: filedAt,
      report_date: reportDate,
      acceptance_datetime: acceptanceDateTime,
      headline,
      url: primaryDocument ? buildFilingUrl(cikUnpadded, accession, primaryDocument) : '',
      primary_document: primaryDocument.trim() || null,
      primary_doc_description: description.trim() || null,
      items,
      archive_source: archiveSource,
    });
  }

  return out;
}

function dedupeByAccession(filings: SecFiling[]): SecFiling[] {
  const seen = new Set<string>();
  return filings.filter((filing) => {
    const accession = filing.accession_number.trim();
    if (!accession || seen.has(accession)) return false;
    seen.add(accession);
    return true;
  });
}

function filterAndLimit(filings: SecFiling[], opts: Required<GetRecentFilingsOptions>): SecFiling[] {
  const sinceMs = opts.sinceDays > 0 ? Date.now() - opts.sinceDays * 86400000 : 0;

  const filtered = sinceMs === 0
    ? filings
    : filings.filter((f) => {
        const ts = new Date(f.filed_at).getTime();
        return Number.isFinite(ts) ? ts >= sinceMs : true;
      });

  filtered.sort((a, b) => {
    const filedCompare = b.filed_at.localeCompare(a.filed_at);
    if (filedCompare !== 0) return filedCompare;
    return (b.acceptance_datetime ?? '').localeCompare(a.acceptance_datetime ?? '');
  });

  return filtered.slice(0, opts.limit);
}

function shouldFetchArchiveFile(file: RawArchiveFile, sinceDays: number): boolean {
  if (sinceDays <= 0) return true;
  const filingTo = file.filingTo ?? file.filingFrom;
  if (!filingTo) return true;
  const sinceMs = Date.now() - sinceDays * 86400000;
  const filingToMs = new Date(filingTo).getTime();
  return Number.isFinite(filingToMs) ? filingToMs >= sinceMs : true;
}

async function fetchArchiveFilings(args: {
  payload: RawSubmissionsPayload;
  tickerRequested: string;
  tickerAtIngest: string | null;
  sinceDays: number;
  targetCount: number;
  existingCount: number;
}): Promise<SecFiling[]> {
  const files = args.payload.filings?.files;
  if (!Array.isArray(files) || args.existingCount >= args.targetCount) return [];

  const archiveFilings: SecFiling[] = [];
  for (const file of files) {
    if (args.existingCount + archiveFilings.length >= args.targetCount) break;
    if (!file.name || !shouldFetchArchiveFile(file, args.sinceDays)) continue;

    const archivePayload = await secFetchJson<RawArchivePayload>(`${SUBMISSIONS_BASE}/${file.name}`);
    archiveFilings.push(...zipFilingColumns({
      columns: archivePayload,
      cik: args.payload.cik,
      tickerRequested: args.tickerRequested,
      tickerAtIngest: args.tickerAtIngest,
      archiveSource: file.name,
    }));
  }

  return archiveFilings;
}

async function persistRawFilings(filings: SecFiling[]): Promise<void> {
  if (filings.length === 0) return;

  const db = getDb();
  if (!db) return;

  const now = new Date();
  const rows = filings.map((filing) => ({
    accessionNumber: filing.accession_number,
    cik: filing.cik,
    tickerRequested: filing.ticker_requested,
    tickerAtIngest: filing.ticker_at_ingest,
    formType: filing.form_type,
    filedAt: filing.filed_at,
    reportDate: filing.report_date,
    acceptanceDateTime: filing.acceptance_datetime,
    items: filing.items,
    primaryDocument: filing.primary_document,
    primaryDocDescription: filing.primary_doc_description,
    secUrl: filing.url || null,
    archiveSource: filing.archive_source,
    metadataJson: filing,
    fetchedAt: now,
    updatedAt: now,
  }));

  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await db
      .insert(secFilingsRaw)
      .values(chunk)
      .onConflictDoUpdate({
        target: secFilingsRaw.accessionNumber,
        set: {
          cik: sql`excluded.cik`,
          tickerRequested: sql`excluded.ticker_requested`,
          tickerAtIngest: sql`excluded.ticker_at_ingest`,
          formType: sql`excluded.form_type`,
          filedAt: sql`excluded.filed_at`,
          reportDate: sql`excluded.report_date`,
          acceptanceDateTime: sql`excluded.acceptance_datetime`,
          items: sql`excluded.items`,
          primaryDocument: sql`excluded.primary_document`,
          primaryDocDescription: sql`excluded.primary_doc_description`,
          secUrl: sql`excluded.sec_url`,
          archiveSource: sql`excluded.archive_source`,
          metadataJson: sql`excluded.metadata_json`,
          updatedAt: now,
        },
      });
  }
}

export async function getRecentFilings(
  rawTicker: string,
  options: GetRecentFilingsOptions = {},
): Promise<SubmissionsResponse> {
  const opts: Required<GetRecentFilingsOptions> = {
    limit: options.limit ?? DEFAULT_LIMIT,
    sinceDays: options.sinceDays ?? DEFAULT_SINCE_DAYS,
    includeArchives: options.includeArchives ?? false,
    persistRaw: options.persistRaw ?? false,
  };
  const tickerRequested = normalizeTicker(rawTicker);

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
    const recent = zipFilingColumns({
      columns: payload.filings?.recent,
      cik: payload.cik,
      tickerRequested,
      tickerAtIngest: cikEntry.ticker,
      archiveSource: null,
    });
    const archiveFilings = opts.includeArchives
      ? await fetchArchiveFilings({
          payload,
          tickerRequested,
          tickerAtIngest: cikEntry.ticker,
          sinceDays: opts.sinceDays,
          targetCount: opts.limit,
          existingCount: recent.length,
        })
      : [];
    const all = dedupeByAccession([...recent, ...archiveFilings]);
    const results = filterAndLimit(all, opts);
    if (opts.persistRaw) {
      await persistRawFilings(results).catch((persistError) => {
        console.warn('[sec-submissions] raw metadata persist failed:', persistError);
      });
    }
    return { status: 'success', count: results.length, results };
  } catch (error) {
    const message = error instanceof Error
      ? `${error instanceof SecHttpError ? `SEC ${error.status}` : 'SEC request failed'}: ${error.message}`
      : 'SEC request failed';
    console.warn(`[sec-submissions] fetch failed for ${rawTicker}: ${message}`);
    return { status: 'error', count: 0, results: [], error: message };
  }
}

export async function getSecFilingsForProfile(
  rawTicker: string,
  profile: SecFilingPullProfile,
): Promise<SubmissionsResponse> {
  const config = getSecFilingPullProfileConfig(profile);
  return getRecentFilings(rawTicker, {
    limit: config.limit,
    sinceDays: config.sinceDays,
    includeArchives: true,
    persistRaw: true,
  });
}

export async function getResearchFilings(rawTicker: string): Promise<SubmissionsResponse> {
  return getSecFilingsForProfile(rawTicker, 'research-filings');
}

import { getCikForTicker } from '@/lib/sec/cik-map';
import { getFilingBody } from '@/lib/sec/filing-body';
import {
  extractOfferingFrom424B,
  extractOfferingFrom8K101,
  extractOfferingFrom8K302,
} from '@/lib/sec/offerings-extractors';
import { getSecFilingPullProfileConfig, getSecFilingsForProfile } from '@/lib/sec/submissions';
import type { ExtractedOfferingFields, RawOffering } from '@/lib/sec/offerings-extractors';

export type { RawOffering } from '@/lib/sec/offerings-extractors';

export interface OfferingsResponse {
  status: 'success' | 'error';
  count: number;
  results: RawOffering[];
  error?: string;
}

const DEFAULT_LIMIT = 50;
const OFFERING_PROFILE = getSecFilingPullProfileConfig('completed-offerings');
const FORM_424B_REGEX = /^424B[1-7]$/i;
const FORM_8K_REGEX = /^8-K(\/A)?$/i;

function hasItemCode(items: string | null, target: '3.02' | '1.01'): boolean {
  if (items === null) return true;
  return items
    .split(',')
    .map((item) => item.trim())
    .some((item) => item === target);
}

function isCandidateFiling(formType: string, items: string | null): boolean {
  if (FORM_424B_REGEX.test(formType)) return true;
  if (!FORM_8K_REGEX.test(formType)) return false;
  return hasItemCode(items, '3.02') || hasItemCode(items, '1.01');
}

function extractFromFiling(
  formType: string,
  items: string | null,
  bodyText: string,
): ExtractedOfferingFields | null {
  if (FORM_424B_REGEX.test(formType)) {
    return extractOfferingFrom424B(bodyText, formType);
  }

  if (!FORM_8K_REGEX.test(formType)) return null;

  if (hasItemCode(items, '3.02')) {
    const extracted = extractOfferingFrom8K302(bodyText);
    if (extracted) return extracted;
  }

  if (hasItemCode(items, '1.01')) {
    return extractOfferingFrom8K101(bodyText);
  }

  return null;
}

export async function getOfferings(
  rawTicker: string,
  options?: { sinceDays?: number; limit?: number },
): Promise<OfferingsResponse> {
  let cikEntry;
  try {
    cikEntry = await getCikForTicker(rawTicker);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CIK lookup failed';
    return { status: 'error', count: 0, results: [], error: message };
  }

  if (!cikEntry) {
    return { status: 'success', count: 0, results: [] };
  }

  const filings = options
    ? await getSecFilingsForProfile(rawTicker, 'completed-offerings').then((response) => ({
        ...response,
        results: response.results
          .filter((filing) => {
            if (options.sinceDays === undefined) return true;
            const ts = new Date(filing.filed_at).getTime();
            return Number.isFinite(ts) ? ts >= Date.now() - options.sinceDays * 86400000 : true;
          })
          .slice(0, options.limit ?? DEFAULT_LIMIT),
      }))
    : await getSecFilingsForProfile(rawTicker, 'completed-offerings');
  if (filings.status === 'error') {
    return {
      status: 'error',
      count: 0,
      results: [],
      error: filings.error ?? 'SEC submissions lookup failed',
    };
  }

  const candidateFilings = filings.results
    .filter((filing) => isCandidateFiling(filing.form_type, filing.items))
    .slice(0, options?.limit ?? OFFERING_PROFILE.parseCandidateLimit);
  const results: RawOffering[] = [];

  for (const filing of candidateFilings) {
    const body = await getFilingBody({
      accessionNumber: filing.accession_number,
      cik: cikEntry.cik,
      formType: filing.form_type,
      filedAt: filing.filed_at,
      primaryDocUrl: filing.url,
    });
    if (!body) continue;

    const extracted = extractFromFiling(filing.form_type, filing.items, body.text);
    if (!extracted) continue;

    results.push({
      accessionNumber: filing.accession_number,
      formType: filing.form_type,
      filedAt: filing.filed_at,
      url: filing.url,
      ...extracted,
    });
  }

  results.sort((a, b) => b.filedAt.localeCompare(a.filedAt));

  return { status: 'success', count: results.length, results };
}

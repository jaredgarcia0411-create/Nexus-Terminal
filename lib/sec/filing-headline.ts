import { eq, inArray } from 'drizzle-orm';

import { getDb } from '@/lib/db';
import { secFilingsRaw } from '@/lib/db/schema';
import { secFetchJson, secFetchText } from '@/lib/sec/client';
import type { SecFiling } from '@/lib/sec/submissions';

const PR_EXHIBIT_FORMS = new Set(['6-K', '8-K']);
const HEADLINE_ENRICH_LIMIT = 8;
const MIN_HEADLINE_LEN = 25;
const MAX_HEADLINE_LEN = 220;

const ENTITY: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': '\'',
  '&#x27;': '\'',
  '&nbsp;': ' ',
};

const BOILERPLATE_RE = /^(exhibit|ex[-\s]?99|form\s|for immediate release|table of contents|page\s|united states|securities and exchange|free writing prospectus|\d+\s*$)/i;
const DATELINE_RE = /^[A-Z][A-Za-z.\s]+,\s+[A-Z][a-z]+\.?\s+\d{1,2},\s+\d{4}/;

function baseForm(formType: string): string {
  const normalized = formType.trim().toUpperCase();
  return normalized.endsWith('/A') ? normalized.slice(0, -2) : normalized;
}

function truncateHeadline(line: string): string {
  return line.length > MAX_HEADLINE_LEN ? line.slice(0, MAX_HEADLINE_LEN) : line;
}

function isHeadlineLike(line: string): boolean {
  if (line.length < MIN_HEADLINE_LEN) return false;
  if (!/[A-Za-z]/.test(line)) return false;
  if ((line.match(/\b[\w'-]+\b/g) ?? []).length < 4) return false;
  if (BOILERPLATE_RE.test(line)) return false;
  if (DATELINE_RE.test(line)) return false;
  return true;
}

function headlineFromDateline(line: string): string | null {
  if (!DATELINE_RE.test(line)) return null;

  const tail = line
    .split(/\s+(?:--|—)\s+|\)\s+(?:--|—)?\s*/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1);

  return tail && isHeadlineLike(tail) ? truncateHeadline(tail) : null;
}

export function extractPrHeadline(html: string): string | null {
  const lines = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|td|tr|table)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|#x27|nbsp);/gi, (entity) => ENTITY[entity.toLowerCase()] ?? ' ')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  for (const line of lines) {
    const datelineHeadline = headlineFromDateline(line);
    if (datelineHeadline) return datelineHeadline;
    if (isHeadlineLike(line)) return truncateHeadline(line);
  }

  return null;
}

async function fetchExhibitHeadline(cik: string, accession: string): Promise<string | null> {
  const cikUnpadded = String(parseInt(cik, 10));
  const accNoDashes = accession.replace(/-/g, '');
  const baseUrl = `https://www.sec.gov/Archives/edgar/data/${cikUnpadded}/${accNoDashes}`;
  const idx = await secFetchJson<{
    directory?: { item?: Array<{ name?: string; type?: string }> };
  }>(`${baseUrl}/index.json`);
  const items = idx.directory?.item ?? [];
  const exhibit = items.find((item) => item.type && /^EX-99(\.0?1)?$/i.test(item.type))
    ?? items.find((item) => item.name && /ex-?99[._-]?0?1/i.test(item.name));

  if (!exhibit?.name) return null;

  const html = await secFetchText(`${baseUrl}/${exhibit.name}`);
  return extractPrHeadline(html);
}

export async function enrichFilingHeadlines(filings: SecFiling[]): Promise<Map<string, string>> {
  const db = getDb();
  if (!db || filings.length === 0) return new Map();

  const accessions = filings
    .map((filing) => filing.accession_number.trim())
    .filter(Boolean);
  if (accessions.length === 0) return new Map();

  const rows = await db
    .select({
      accessionNumber: secFilingsRaw.accessionNumber,
      prHeadline: secFilingsRaw.prHeadline,
    })
    .from(secFilingsRaw)
    .where(inArray(secFilingsRaw.accessionNumber, accessions));

  const cached = new Map(rows.map((row) => [row.accessionNumber, row.prHeadline]));
  const result = new Map<string, string>();
  for (const row of rows) {
    if (row.prHeadline) result.set(row.accessionNumber, row.prHeadline);
  }

  const candidates = filings
    .filter((filing) => {
      const accession = filing.accession_number.trim();
      return PR_EXHIBIT_FORMS.has(baseForm(filing.form_type)) && (cached.get(accession) == null);
    })
    .slice(0, HEADLINE_ENRICH_LIMIT);

  for (const filing of candidates) {
    try {
      const headline = await fetchExhibitHeadline(filing.cik, filing.accession_number);
      const value = headline ?? '';
      await db
        .update(secFilingsRaw)
        .set({ prHeadline: value, updatedAt: new Date() })
        .where(eq(secFilingsRaw.accessionNumber, filing.accession_number));
      if (headline) result.set(filing.accession_number, headline);
    } catch (error) {
      console.warn('[filing-headline] enrich failed', filing.accession_number, error);
    }
  }

  return result;
}

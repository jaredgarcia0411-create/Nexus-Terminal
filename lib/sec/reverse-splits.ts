import { getCikForTicker } from '@/lib/sec/cik-map';
import { getFilingBody } from '@/lib/sec/filing-body';
import { getRecentFilings } from '@/lib/sec/submissions';

export interface ReverseSplit {
  ratio: string;
  executionDate: string | null;
  announcementDate: string;
  accessionNumber: string;
  url: string;
}

export interface ReverseSplitsResponse {
  status: 'success' | 'error';
  count: number;
  results: ReverseSplit[];
  error?: string;
}

interface RawSplit {
  ratio: string;
  executionDate: string | null;
}

const MAX_SCAN_CHARS = 50_000;
const CONTEXT_WINDOW_CHARS = 200;

const RATIO_PATTERNS: RegExp[] = [
  /(\d+)\s*[-\s]?\s*(?:for|to|:)\s*[-\s]?\s*(\d+)\s+reverse\s+(?:stock\s+)?split/i,
  /reverse\s+(?:stock\s+)?split\s+(?:at\s+(?:a\s+)?ratio\s+of\s+)?(\d+)\s*[-\s]?\s*(?:for|to|:)\s*[-\s]?\s*(\d+)/i,
  /(\d+)\s*[-\s]?\s*(?:for|to)\s*[-\s]?\s*(\d+)\s+(?:share\s+)?consolidation/i,
];

const WORD_RATIO_PATTERNS: RegExp[] = [
  /\b([a-z-]+)\s*[-\s]?(?:for|to)\s*[-\s]?([a-z-]+)\s+reverse\s+(?:stock\s+)?split/i,
  /\breverse\s+(?:stock\s+)?split\s+(?:at\s+(?:a\s+)?ratio\s+of\s+)?([a-z-]+)\s*[-\s]?(?:for|to)\s*[-\s]?([a-z-]+)/i,
  /\b([a-z-]+)\s*[-\s]?(?:for|to)\s*[-\s]?([a-z-]+)\s+(?:share\s+)?consolidation/i,
];

const DATE_PATTERNS: RegExp[] = [
  /effective\s+(?:on\s+|as\s+of\s+|date\s+of\s+)?([A-Z][a-z]+\s+\d{1,2},\s*\d{4})/i,
  /effective\s+(?:on\s+|as\s+of\s+)?(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
  /effective\s+(?:on\s+|as\s+of\s+)?(\d{4}-\d{2}-\d{2})/i,
];

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
};

function normalizeRatio(numerator: number, denominator: number): string | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (numerator <= 0 || denominator <= 0) return null;
  if (numerator >= denominator) return null;
  return `${numerator}-for-${denominator}`;
}

function parseWordNumber(value: string): number | null {
  // The caller's regex captures hyphens inside [a-z-]+, so values like "one-" can
  // arrive when the boundary hyphen is consumed by the word group. Trim again
  // after collapsing separators so the split into parts doesn't leave empties.
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, ' ').trim();
  if (!normalized) return null;

  const parts = normalized.split(' ');
  let total = 0;
  let current = 0;

  for (const part of parts) {
    if (part === 'and') continue;
    const number = NUMBER_WORDS[part];
    if (number === undefined) return null;

    if (number === 100) {
      current = Math.max(1, current) * 100;
      continue;
    }

    current += number;
  }

  total += current;
  return total > 0 ? total : null;
}

function extractExecutionDate(text: string, matchIndex: number, matchLength: number): string | null {
  const start = Math.max(0, matchIndex - CONTEXT_WINDOW_CHARS);
  const end = Math.min(text.length, matchIndex + matchLength + CONTEXT_WINDOW_CHARS);
  const context = text.slice(start, end);

  for (const pattern of DATE_PATTERNS) {
    const match = pattern.exec(context);
    if (!match?.[1]) continue;

    const parsed = parseFlexibleDate(match[1]);
    if (parsed) return parsed;
  }

  return null;
}

function tryDigitPatterns(text: string): RawSplit | null {
  for (const pattern of RATIO_PATTERNS) {
    const match = pattern.exec(text);
    if (!match?.[1] || !match[2]) continue;

    const numerator = Number.parseInt(match[1], 10);
    const denominator = Number.parseInt(match[2], 10);
    const ratio = normalizeRatio(numerator, denominator);
    if (!ratio) continue;

    return {
      ratio,
      executionDate: extractExecutionDate(text, match.index, match[0].length),
    };
  }

  return null;
}

function tryWordPatterns(text: string): RawSplit | null {
  for (const pattern of WORD_RATIO_PATTERNS) {
    const match = pattern.exec(text);
    if (!match?.[1] || !match[2]) continue;

    const numerator = parseWordNumber(match[1]);
    const denominator = parseWordNumber(match[2]);
    if (numerator === null || denominator === null) continue;

    const ratio = normalizeRatio(numerator, denominator);
    if (!ratio) continue;

    return {
      ratio,
      executionDate: extractExecutionDate(text, match.index, match[0].length),
    };
  }

  return null;
}

export function extractReverseSplit(text: string): RawSplit | null {
  const clipped = text.slice(0, MAX_SCAN_CHARS).trim();
  if (!clipped) return null;

  return tryDigitPatterns(clipped) ?? tryWordPatterns(clipped);
}

export function parseFlexibleDate(value: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(value.trim());
  if (slash) {
    const month = Number.parseInt(slash[1], 10);
    const day = Number.parseInt(slash[2], 10);
    let year = Number.parseInt(slash[3], 10);
    if (year < 100) year += 2000;
    return toIsoDate(year, month, day);
  }

  const long = /^([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})$/i.exec(value.trim());
  if (long) {
    const month = monthNameToNumber(long[1]);
    const day = Number.parseInt(long[2], 10);
    const year = Number.parseInt(long[3], 10);
    if (!month) return null;
    return toIsoDate(year, month, day);
  }

  return null;
}

function monthNameToNumber(month: string): number | null {
  const index = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
  ].indexOf(month.toLowerCase());
  return index >= 0 ? index + 1 : null;
}

function toIsoDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

export async function getReverseSplits(
  rawTicker: string,
  options?: { sinceDays?: number },
): Promise<ReverseSplitsResponse> {
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

  const filings = await getRecentFilings(rawTicker, {
    limit: 200,
    sinceDays: options?.sinceDays ?? 365 * 10,
  });
  if (filings.status === 'error') {
    return {
      status: 'error',
      count: 0,
      results: [],
      error: filings.error ?? 'SEC submissions lookup failed',
    };
  }

  const candidateFilings = filings.results.filter((filing) => (
    /^8-K(\/A)?$/i.test(filing.form_type)
      && (filing.items === null || filing.items.includes('5.03'))
  ));

  const matches: ReverseSplit[] = [];
  for (const filing of candidateFilings) {
    const body = await getFilingBody({
      accessionNumber: filing.accession_number,
      cik: cikEntry.cik,
      formType: filing.form_type,
      filedAt: filing.filed_at,
      primaryDocUrl: filing.url,
    });
    if (!body) continue;

    const extracted = extractReverseSplit(body.text);
    if (!extracted) continue;

    matches.push({
      ratio: extracted.ratio,
      executionDate: extracted.executionDate,
      announcementDate: filing.filed_at,
      accessionNumber: filing.accession_number,
      url: filing.url,
    });
  }

  matches.sort((a, b) => b.announcementDate.localeCompare(a.announcementDate));
  return { status: 'success', count: matches.length, results: matches };
}

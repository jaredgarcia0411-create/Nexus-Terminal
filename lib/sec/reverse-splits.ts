import { getCikForTicker } from '@/lib/sec/cik-map';
import { getFilingBody } from '@/lib/sec/filing-body';
import { getSecFilingPullProfileConfig, getSecFilingsForProfile } from '@/lib/sec/submissions';

export type ReverseSplitLifecycleStatus = 'proposed' | 'approved' | 'announced' | 'effective' | 'completed';
export type ReverseSplitConfidence = 'high' | 'medium' | 'low';

export interface ReverseSplit {
  ratio: string;
  executionDate: string | null;
  effectiveDate: string | null;
  voteApprovalDate: string | null;
  announcementDate: string;
  lifecycleStatus: ReverseSplitLifecycleStatus;
  accessionNumber: string;
  url: string;
  sourceSnippet: string | null;
  confidence: ReverseSplitConfidence;
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
  effectiveDate: string | null;
  announcementDate: string | null;
  voteApprovalDate: string | null;
  lifecycleStatus: ReverseSplitLifecycleStatus;
  sourceSnippet: string | null;
  confidence: ReverseSplitConfidence;
}

const MAX_SCAN_CHARS = 50_000;
const CONTEXT_WINDOW_CHARS = 200;
const REVERSE_SPLIT_PROFILE = getSecFilingPullProfileConfig('reverse-splits');
const FORM_8K_REGEX = /^8-K(\/A)?$/i;
const FORM_6K_REGEX = /^6-K(\/A)?$/i;
const REVERSE_SPLIT_8K_ITEMS = ['5.03', '8.01'] as const;

const RATIO_PATTERNS: RegExp[] = [
  /(\d+)\s*[-\s]?\s*(?:for|to|:)\s*[-\s]?\s*(\d+)\s+reverse\s+(?:stock\s+)?split/i,
  /reverse\s+(?:stock\s+)?split\s+(?:at\s+(?:a\s+)?ratio\s+of\s+)?(\d+)\s*[-\s]?\s*(?:for|to|:)\s*[-\s]?\s*(\d+)/i,
  /(\d+)\s*[-\s]?\s*(?:for|to)\s*[-\s]?\s*(\d+)\s+(?:share\s+)?consolidation/i,
  /(?:one|1)\s+(?:post[-\s]split\s+)?share\s+for\s+every\s+(\d+)\s+(?:pre[-\s]split\s+)?shares?/i,
];

const WORD_RATIO_PATTERNS: RegExp[] = [
  /\b([a-z-]+)\s*[-\s]?(?:for|to)\s*[-\s]?([a-z-]+)\s+reverse\s+(?:stock\s+)?split/i,
  /\breverse\s+(?:stock\s+)?split\s+(?:at\s+(?:a\s+)?ratio\s+of\s+)?([a-z-]+)\s*[-\s]?(?:for|to)\s*[-\s]?([a-z-]+)/i,
  /\b([a-z-]+)\s*[-\s]?(?:for|to)\s*[-\s]?([a-z-]+)\s+(?:share\s+)?consolidation/i,
  /\bone\s+(?:post[-\s]split\s+)?share\s+for\s+every\s+([a-z-]+)\s+(?:pre[-\s]split\s+)?shares?/i,
];

const DATE_PATTERNS: RegExp[] = [
  /effective\s+(?:on\s+|as\s+of\s+|date\s+of\s+)?([A-Z][a-z]+\s+\d{1,2},\s*\d{4})/i,
  /effective\s+(?:on\s+|as\s+of\s+)?(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
  /effective\s+(?:on\s+|as\s+of\s+)?(\d{4}-\d{2}-\d{2})/i,
];

const ANY_DATE_PATTERN = /\b(?:[A-Z][a-z]+\s+\d{1,2},\s*\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})\b/;

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

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function getContextWindow(text: string, matchIndex: number, matchLength: number): string {
  const start = Math.max(0, matchIndex - CONTEXT_WINDOW_CHARS);
  const end = Math.min(text.length, matchIndex + matchLength + CONTEXT_WINDOW_CHARS);
  return text.slice(start, end);
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
  const context = getContextWindow(text, matchIndex, matchLength);

  for (const pattern of DATE_PATTERNS) {
    const match = pattern.exec(context);
    if (!match?.[1]) continue;

    const parsed = parseFlexibleDate(match[1]);
    if (parsed) return parsed;
  }

  return null;
}

function extractDateNear(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;

    const context = getContextWindow(text, match.index, match[0].length);
    const dateMatch = ANY_DATE_PATTERN.exec(context);
    if (!dateMatch?.[0]) continue;

    const parsed = parseFlexibleDate(dateMatch[0]);
    if (parsed) return parsed;
  }

  return null;
}

function inferLifecycleStatus(text: string): ReverseSplitLifecycleStatus {
  if (/\b(?:effected|implemented|completed|consummated)\b[^.]{0,220}\b(?:reverse\s+(?:stock\s+)?split|share\s+consolidation)\b/i.test(text)) {
    return 'completed';
  }
  if (/\b(?:reverse\s+(?:stock\s+)?split|share\s+consolidation)\b[^.]{0,220}\b(?:effected|implemented|completed|consummated)\b/i.test(text)) {
    return 'completed';
  }
  if (/\beffective\b/i.test(text)) return 'effective';
  if (/\b(?:stockholders?|shareholders?)\s+approved\b|\bapproved\s+by\s+(?:the\s+)?(?:stockholders?|shareholders?)\b|\bboard\s+approved\b|\bapproved\b[^.]{0,120}\breverse\s+(?:stock\s+)?split\b/i.test(text)) {
    return 'approved';
  }
  if (/\b(?:proposed|proposal|proposing|seek(?:ing)?\s+(?:stockholder|shareholder)\s+approval|will\s+vote|to\s+approve)\b/i.test(text)) {
    return 'proposed';
  }

  return 'announced';
}

function confidenceForSplit(
  lifecycleStatus: ReverseSplitLifecycleStatus,
  effectiveDate: string | null,
  voteApprovalDate: string | null,
): ReverseSplitConfidence {
  if (effectiveDate !== null || voteApprovalDate !== null || lifecycleStatus === 'completed' || lifecycleStatus === 'effective') {
    return 'high';
  }
  if (lifecycleStatus === 'approved' || lifecycleStatus === 'announced') return 'medium';
  return 'low';
}

function buildRawSplit(text: string, matchIndex: number, matchLength: number, ratio: string): RawSplit {
  const context = getContextWindow(text, matchIndex, matchLength);
  const effectiveDate = extractExecutionDate(text, matchIndex, matchLength);
  const voteApprovalDate = extractDateNear(text, [
    /\b(?:stockholders?|shareholders?)\s+approved\b/i,
    /\bapproved\s+by\s+(?:the\s+)?(?:stockholders?|shareholders?)\b/i,
    /\b(?:annual|special)\s+meeting\b/i,
    /\bboard\s+approved\b/i,
    /\bapproved\s+(?:a|the)\s+reverse\s+(?:stock\s+)?split\b/i,
  ]);
  const announcementDate = extractDateNear(text, [
    /\bannounced\b/i,
    /\bpublicly\s+announced\b/i,
  ]);
  const lifecycleStatus = inferLifecycleStatus(context);

  return {
    ratio,
    executionDate: effectiveDate,
    effectiveDate,
    announcementDate,
    voteApprovalDate,
    lifecycleStatus,
    sourceSnippet: compactWhitespace(context).slice(0, 500),
    confidence: confidenceForSplit(lifecycleStatus, effectiveDate, voteApprovalDate),
  };
}

function tryDigitPatterns(text: string): RawSplit | null {
  for (const pattern of RATIO_PATTERNS) {
    const match = pattern.exec(text);
    if (!match?.[1]) continue;

    const numerator = match[2] ? Number.parseInt(match[1], 10) : 1;
    const denominator = Number.parseInt(match[2] ?? match[1], 10);
    const ratio = normalizeRatio(numerator, denominator);
    if (!ratio) continue;

    return buildRawSplit(text, match.index, match[0].length, ratio);
  }

  return null;
}

function tryWordPatterns(text: string): RawSplit | null {
  for (const pattern of WORD_RATIO_PATTERNS) {
    const match = pattern.exec(text);
    if (!match?.[1]) continue;

    const numerator = match[2] ? parseWordNumber(match[1]) : 1;
    const denominator = parseWordNumber(match[2] ?? match[1]);
    if (numerator === null || denominator === null) continue;

    const ratio = normalizeRatio(numerator, denominator);
    if (!ratio) continue;

    return buildRawSplit(text, match.index, match[0].length, ratio);
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

function hasItemCode(items: string | null, target: typeof REVERSE_SPLIT_8K_ITEMS[number]): boolean {
  if (items === null) return true;
  return items
    .split(',')
    .map((item) => item.trim().replace(/^Item\s+/i, ''))
    .some((item) => item === target);
}

function hasAnyReverseSplit8KItem(items: string | null): boolean {
  return REVERSE_SPLIT_8K_ITEMS.some((item) => hasItemCode(items, item));
}

function isProxyCandidateForm(formType: string): boolean {
  const key = formType.toUpperCase().replace(/\s+/g, '');
  return /^(?:DEF|PRE)14[AC](?:\/A)?$/.test(key)
    || /^(?:DEFA|PREA|DFAN|DEFC|DEFR|PREC)14[AC]$/.test(key);
}

function isCandidateFiling(formType: string, items: string | null): boolean {
  if (FORM_6K_REGEX.test(formType)) return true;
  if (isProxyCandidateForm(formType)) return true;
  if (!FORM_8K_REGEX.test(formType)) return false;
  return hasAnyReverseSplit8KItem(items);
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

  const filings = await getSecFilingsForProfile(rawTicker, 'reverse-splits');
  if (filings.status === 'error') {
    return {
      status: 'error',
      count: 0,
      results: [],
      error: filings.error ?? 'SEC submissions lookup failed',
    };
  }

  const candidateFilings = filings.results.filter((filing) => (
    isCandidateFiling(filing.form_type, filing.items)
      && (
        options?.sinceDays === undefined
        || new Date(filing.filed_at).getTime() >= Date.now() - options.sinceDays * 86400000
      )
  )).slice(0, REVERSE_SPLIT_PROFILE.parseCandidateLimit);

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
      effectiveDate: extracted.effectiveDate,
      voteApprovalDate: extracted.voteApprovalDate,
      announcementDate: extracted.announcementDate ?? filing.filed_at,
      lifecycleStatus: extracted.lifecycleStatus,
      accessionNumber: filing.accession_number,
      url: filing.url,
      sourceSnippet: extracted.sourceSnippet,
      confidence: extracted.confidence,
    });
  }

  matches.sort((a, b) => b.announcementDate.localeCompare(a.announcementDate));
  return { status: 'success', count: matches.length, results: matches };
}

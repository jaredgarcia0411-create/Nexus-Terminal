import { getCikForTicker } from '@/lib/sec/cik-map';
import { getFilingBody } from '@/lib/sec/filing-body';
import { getSecFilingPullProfileConfig, getSecFilingsForProfile } from '@/lib/sec/submissions';

export type IdentityEventType =
  | 'ticker_change'
  | 'name_change'
  | 'cik_identity_continuity'
  | 'exchange_listing_change';

export type IdentityEventConfidence = 'high' | 'medium' | 'low';

export interface IdentityEvent {
  previousTicker: string | null;
  currentTicker: string | null;
  previousCompanyName: string | null;
  currentCompanyName: string | null;
  effectiveDate: string | null;
  exchangeMarket: string | null;
  eventTypes: IdentityEventType[];
  filedAt: string;
  formType: string;
  accessionNumber: string;
  url: string;
  sourceSnippet: string | null;
  confidence: IdentityEventConfidence;
}

export interface IdentityEventsResponse {
  status: 'success' | 'error';
  count: number;
  results: IdentityEvent[];
  error?: string;
}

interface RawIdentityEvent {
  previousTicker: string | null;
  currentTicker: string | null;
  previousCompanyName: string | null;
  currentCompanyName: string | null;
  effectiveDate: string | null;
  exchangeMarket: string | null;
  eventTypes: IdentityEventType[];
  sourceSnippet: string | null;
  confidence: IdentityEventConfidence;
}

interface MatchValue {
  value: string;
  index: number;
  length: number;
  listingChange: boolean;
}

const MAX_SCAN_CHARS = 60_000;
const CONTEXT_WINDOW_CHARS = 260;
const IDENTITY_PROFILE = getSecFilingPullProfileConfig('symbol-changes');
const FORM_8K_REGEX = /^8-K(\/A)?$/i;
const FORM_6K_REGEX = /^6-K(\/A)?$/i;
const IDENTITY_8K_ITEMS = ['5.03', '8.01'] as const;
const COMMON_TICKER_FALSE_POSITIVES = new Set([
  'AND',
  'CUSIP',
  'NASDAQ',
  'NYSE',
  'OTC',
  'SEC',
  'THE',
]);

const COMPANY_SUFFIX =
  '(?:\\bInc\\.?|\\bIncorporated\\b|\\bCorp\\.?|\\bCorporation\\b|\\bCompany\\b|\\bCo\\.?|\\bLtd\\.?|\\bLimited\\b|\\bPLC\\b|\\bS\\.A\\.|\\bN\\.V\\.|\\bLLC\\b|\\bHoldings?\\b|\\bGroup\\b)';

const DATE_PATTERNS: RegExp[] = [
  /effective\s+(?:on\s+|as\s+of\s+|date\s+of\s+)?([A-Z][a-z]+\s+\d{1,2},\s*\d{4})/i,
  /effective\s+(?:on\s+|as\s+of\s+)?(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
  /effective\s+(?:on\s+|as\s+of\s+)?(\d{4}-\d{2}-\d{2})/i,
  /\bas\s+of\s+([A-Z][a-z]+\s+\d{1,2},\s*\d{4})/i,
  /\bas\s+of\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
  /\bas\s+of\s+(\d{4}-\d{2}-\d{2})/i,
];

const TICKER_PAIR_PATTERNS: Array<{
  pattern: RegExp;
  previousGroup: number;
  currentGroup: number;
}> = [
  {
    pattern: /\b(?:ticker|trading)\s+symbol\s+(?:will\s+)?(?:change|changed|be\s+changed)\s+from\s+["'“”]?([A-Z][A-Z0-9.\-]{0,9})["'“”]?\s+to\s+["'“”]?([A-Z][A-Z0-9.\-]{0,9})["'“”]?/i,
    previousGroup: 1,
    currentGroup: 2,
  },
  {
    pattern: /\b(?:old|former|previous)\s+(?:ticker|trading)\s+symbol\s*[:\-]?\s*["'“”]?([A-Z][A-Z0-9.\-]{0,9})["'“”]?.{0,180}\b(?:new|current)\s+(?:ticker|trading)\s+symbol\s*[:\-]?\s*["'“”]?([A-Z][A-Z0-9.\-]{0,9})["'“”]?/i,
    previousGroup: 1,
    currentGroup: 2,
  },
  {
    pattern: /\b(?:new|current)\s+(?:ticker|trading)\s+symbol\s*[:\-]?\s*["'“”]?([A-Z][A-Z0-9.\-]{0,9})["'“”]?.{0,180}\b(?:old|former|previous)\s+(?:ticker|trading)\s+symbol\s*[:\-]?\s*["'“”]?([A-Z][A-Z0-9.\-]{0,9})["'“”]?/i,
    previousGroup: 2,
    currentGroup: 1,
  },
  {
    pattern: /\b(?:under|on)\s+(?:the\s+)?(?:new\s+)?(?:ticker|trading)\s+symbol\s+["'“”]?([A-Z][A-Z0-9.\-]{0,9})["'“”]?.{0,180}\b(?:previously|formerly)\s+(?:traded\s+)?(?:under\s+)?(?:the\s+)?(?:ticker|symbol)\s+["'“”]?([A-Z][A-Z0-9.\-]{0,9})["'“”]?/i,
    previousGroup: 2,
    currentGroup: 1,
  },
];

const NAME_PAIR_PATTERNS: Array<{
  pattern: RegExp;
  previousGroup: number;
  currentGroup: number;
}> = [
  {
    pattern: new RegExp(`\\b(?:changed|changes|will\\s+change|has\\s+changed)\\s+(?:its\\s+)?(?:corporate\\s+)?name\\s+from\\s+(.{2,140}?${COMPANY_SUFFIX})\\s+to\\s+(.{2,140}?${COMPANY_SUFFIX})`, 'i'),
    previousGroup: 1,
    currentGroup: 2,
  },
  {
    pattern: new RegExp(`\\b(?:name|corporate\\s+name)\\s+(?:was\\s+|has\\s+been\\s+|will\\s+be\\s+)?changed\\s+from\\s+(.{2,140}?${COMPANY_SUFFIX})\\s+to\\s+(.{2,140}?${COMPANY_SUFFIX})`, 'i'),
    previousGroup: 1,
    currentGroup: 2,
  },
  {
    pattern: new RegExp(`\\b(?:former|previous)\\s+(?:corporate\\s+)?name\\s*[:\\-]\\s*(.{2,140}?${COMPANY_SUFFIX}).{0,160}\\b(?:new|current)\\s+(?:corporate\\s+)?name\\s*[:\\-]\\s*(.{2,140}?${COMPANY_SUFFIX})`, 'i'),
    previousGroup: 1,
    currentGroup: 2,
  },
  {
    pattern: new RegExp(`\\b(?:new|current)\\s+(?:corporate\\s+)?name\\s*[:\\-]\\s*(.{2,140}?${COMPANY_SUFFIX}).{0,160}\\b(?:former|previous)\\s+(?:corporate\\s+)?name\\s*[:\\-]\\s*(.{2,140}?${COMPANY_SUFFIX})`, 'i'),
    previousGroup: 2,
    currentGroup: 1,
  },
];

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function getContextWindow(text: string, matchIndex: number, matchLength: number): string {
  const start = Math.max(0, matchIndex - CONTEXT_WINDOW_CHARS);
  const end = Math.min(text.length, matchIndex + matchLength + CONTEXT_WINDOW_CHARS);
  return text.slice(start, end);
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

function parseFlexibleDate(value: string): string | null {
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

function normalizeTicker(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/["'“”]/g, '').trim().replace(/[.;,]+$/g, '').toUpperCase();
  if (!/^[A-Z0-9.\-]{1,10}$/.test(normalized)) return null;
  if (!/[A-Z]/.test(normalized)) return null;
  if (COMMON_TICKER_FALSE_POSITIVES.has(normalized)) return null;
  return normalized;
}

function cleanCompanyName(value: string | undefined): string | null {
  if (!value) return null;
  const cleaned = compactWhitespace(value)
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .replace(/\s+(?:effective|on|as of)\s+.*$/i, '')
    .replace(/[.;,:\s]+$/g, '')
    .trim();
  if (cleaned.length < 3) return null;
  if (/^(?:not applicable|n\/a|none)$/i.test(cleaned)) return null;
  return cleaned;
}

function pushEventType(events: IdentityEventType[], eventType: IdentityEventType, shouldPush: boolean): void {
  if (shouldPush && !events.includes(eventType)) events.push(eventType);
}

function findTickerPair(text: string): {
  previousTicker: string;
  currentTicker: string;
  index: number;
  length: number;
} | null {
  for (const { pattern, previousGroup, currentGroup } of TICKER_PAIR_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;

    const previousTicker = normalizeTicker(match[previousGroup]);
    const currentTicker = normalizeTicker(match[currentGroup]);
    if (!previousTicker || !currentTicker || previousTicker === currentTicker) continue;

    return {
      previousTicker,
      currentTicker,
      index: match.index,
      length: match[0].length,
    };
  }

  return null;
}

function findNamePair(text: string): {
  previousCompanyName: string;
  currentCompanyName: string;
  index: number;
  length: number;
} | null {
  for (const { pattern, previousGroup, currentGroup } of NAME_PAIR_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;

    const previousCompanyName = cleanCompanyName(match[previousGroup]);
    const currentCompanyName = cleanCompanyName(match[currentGroup]);
    if (!previousCompanyName || !currentCompanyName || previousCompanyName.toLowerCase() === currentCompanyName.toLowerCase()) continue;

    return {
      previousCompanyName,
      currentCompanyName,
      index: match.index,
      length: match[0].length,
    };
  }

  return null;
}

function findExchangeMarket(text: string): MatchValue | null {
  const transfer = /\b(?:transfer|transferred|move|moved|change|changed)\b[^.]{0,120}\b(?:listing|trading)\b[^.]{0,120}\bfrom\b[^.]{0,120}\bto\s+(the\s+)?(Nasdaq Capital Market|Nasdaq Global Market|Nasdaq Global Select Market|Nasdaq|NYSE American|New York Stock Exchange|NYSE|OTCQB|OTCQX|OTC Pink|OTC Markets)\b/i.exec(text);
  if (transfer?.[2]) {
    return {
      value: transfer[2],
      index: transfer.index,
      length: transfer[0].length,
      listingChange: true,
    };
  }

  const exchange = /\b(Nasdaq Capital Market|Nasdaq Global Market|Nasdaq Global Select Market|Nasdaq|NYSE American|New York Stock Exchange|NYSE|OTCQB|OTCQX|OTC Pink|OTC Markets)\b/i.exec(text);
  if (!exchange?.[1]) return null;

  return {
    value: exchange[1],
    index: exchange.index,
    length: exchange[0].length,
    listingChange: false,
  };
}

function extractEffectiveDate(context: string): string | null {
  for (const pattern of DATE_PATTERNS) {
    const match = pattern.exec(context);
    if (!match?.[1]) continue;
    const parsed = parseFlexibleDate(match[1]);
    if (parsed) return parsed;
  }

  return null;
}

function inferCikContinuity(context: string): boolean {
  return /\bCIK\b[^.]{0,160}\b(?:same|remain(?:s|ed)?|unchanged|continuity|successor|predecessor)\b/i.test(context)
    || /\b(?:same|remain(?:s|ed)?|unchanged|continuity|successor|predecessor)\b[^.]{0,160}\bCIK\b/i.test(context);
}

function confidenceForIdentityEvent(event: RawIdentityEvent): IdentityEventConfidence {
  const hasTickerPair = event.previousTicker !== null && event.currentTicker !== null;
  const hasNamePair = event.previousCompanyName !== null && event.currentCompanyName !== null;
  if ((hasTickerPair || hasNamePair) && event.effectiveDate !== null) return 'high';
  if (hasTickerPair || hasNamePair) return 'medium';
  return 'low';
}

export function extractIdentityEvent(text: string): RawIdentityEvent | null {
  const clipped = compactWhitespace(text.slice(0, MAX_SCAN_CHARS));
  if (!clipped) return null;

  const tickerPair = findTickerPair(clipped);
  const namePair = findNamePair(clipped);
  const exchangeMarket = findExchangeMarket(clipped);

  if (!tickerPair && !namePair && !exchangeMarket) return null;

  const anchorIndex = tickerPair?.index ?? namePair?.index ?? exchangeMarket?.index ?? 0;
  const anchorLength = tickerPair?.length ?? namePair?.length ?? exchangeMarket?.length ?? 0;
  const context = getContextWindow(clipped, anchorIndex, anchorLength);
  const eventTypes: IdentityEventType[] = [];

  pushEventType(eventTypes, 'ticker_change', tickerPair !== null);
  pushEventType(eventTypes, 'name_change', namePair !== null);
  pushEventType(eventTypes, 'exchange_listing_change', exchangeMarket?.listingChange === true);
  pushEventType(eventTypes, 'cik_identity_continuity', inferCikContinuity(context));

  if (eventTypes.length === 0) return null;

  const event: RawIdentityEvent = {
    previousTicker: tickerPair?.previousTicker ?? null,
    currentTicker: tickerPair?.currentTicker ?? null,
    previousCompanyName: namePair?.previousCompanyName ?? null,
    currentCompanyName: namePair?.currentCompanyName ?? null,
    effectiveDate: extractEffectiveDate(context),
    exchangeMarket: exchangeMarket?.value ?? null,
    eventTypes,
    sourceSnippet: compactWhitespace(context).slice(0, 700),
    confidence: 'low',
  };

  event.confidence = confidenceForIdentityEvent(event);
  return event;
}

function hasItemCode(items: string | null, target: typeof IDENTITY_8K_ITEMS[number]): boolean {
  if (items === null) return true;
  return items
    .split(',')
    .map((item) => item.trim().replace(/^Item\s+/i, ''))
    .some((item) => item === target);
}

function hasAnyIdentity8KItem(items: string | null): boolean {
  return IDENTITY_8K_ITEMS.some((item) => hasItemCode(items, item));
}

function isProxyCandidateForm(formType: string): boolean {
  const key = formType.toUpperCase().replace(/\s+/g, '');
  return /^(?:DEF|PRE)14[AC](?:\/A)?$/.test(key)
    || /^(?:DEFA|PREA|DFAN|DEFC|DEFR|PREC)14[AC]$/.test(key);
}

function isRegistrationCandidateForm(formType: string): boolean {
  return /^(?:S|F)-[134](?:\/A)?$/i.test(formType);
}

function isCandidateFiling(formType: string, items: string | null): boolean {
  if (FORM_6K_REGEX.test(formType)) return true;
  if (isProxyCandidateForm(formType)) return true;
  if (isRegistrationCandidateForm(formType)) return true;
  if (!FORM_8K_REGEX.test(formType)) return false;
  return hasAnyIdentity8KItem(items);
}

export async function getIdentityEvents(rawTicker: string): Promise<IdentityEventsResponse> {
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

  const filings = await getSecFilingsForProfile(rawTicker, 'symbol-changes');
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
    .slice(0, IDENTITY_PROFILE.parseCandidateLimit);

  const matches: IdentityEvent[] = [];
  for (const filing of candidateFilings) {
    const body = await getFilingBody({
      accessionNumber: filing.accession_number,
      cik: cikEntry.cik,
      formType: filing.form_type,
      filedAt: filing.filed_at,
      primaryDocUrl: filing.url,
    });
    if (!body) continue;

    const extracted = extractIdentityEvent(body.text);
    if (!extracted) continue;

    matches.push({
      ...extracted,
      filedAt: filing.filed_at,
      formType: filing.form_type,
      accessionNumber: filing.accession_number,
      url: filing.url,
    });
  }

  matches.sort((a, b) => {
    const aDate = a.effectiveDate ?? a.filedAt;
    const bDate = b.effectiveDate ?? b.filedAt;
    return bDate.localeCompare(aDate);
  });

  return { status: 'success', count: matches.length, results: matches };
}

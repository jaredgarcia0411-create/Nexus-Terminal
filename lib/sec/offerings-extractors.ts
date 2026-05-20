const OFFERING_ANCHORS_424B = [
  'THE OFFERING',
  'PROSPECTUS SUPPLEMENT SUMMARY',
  'SUMMARY OF THE OFFERING',
  'OFFERING TERMS',
] as const;

const ANCHOR_WINDOW_CHARS = 10_000;
const FALLBACK_SCAN_CHARS = 60_000;
const RESALE_DETECTION_CHARS = 5_000;
const FIELD_CONTEXT_CHARS = 300;

const MONTHS: Record<string, string> = {
  january: '01',
  february: '02',
  march: '03',
  april: '04',
  may: '05',
  june: '06',
  july: '07',
  august: '08',
  september: '09',
  october: '10',
  november: '11',
  december: '12',
};

export type OfferingType =
  | 'REGISTERED OFFERING'
  | 'ATM USED'
  | 'PRIVATE PLACEMENT'
  | 'PIPE'
  | 'REGISTERED DIRECT'
  | 'PUBLIC OFFERING'
  | 'SHELF TAKEDOWN'
  | 'BEST EFFORTS'
  | 'IPO'
  | null;

export type OfferingStatus =
  | 'announced'
  | 'priced'
  | 'closed'
  | 'terminated'
  | 'resale_only'
  | 'unknown';

export type OfferingConfidence = 'high' | 'medium' | 'low';

export interface RawOffering {
  accessionNumber: string;
  formType: string;
  filedAt: string;
  url: string;
  status: OfferingStatus;
  offeringType: OfferingType;
  sharesAmount: number | null;
  securitiesAmount: number | null;
  sharePrice: number | null;
  offeringAmount: number | null;
  netProceedsAmount: number | null;
  warrantsAmount: number | null;
  isSellingStockholderResale: boolean;
  pricedDate: string | null;
  closedDate: string | null;
  sourceSnippet: string | null;
  confidence: OfferingConfidence;
}

export interface ExtractedOfferingFields {
  status: OfferingStatus;
  offeringType: OfferingType;
  sharesAmount: number | null;
  securitiesAmount: number | null;
  sharePrice: number | null;
  offeringAmount: number | null;
  netProceedsAmount: number | null;
  warrantsAmount: number | null;
  isSellingStockholderResale: boolean;
  pricedDate: string | null;
  closedDate: string | null;
  sourceSnippet: string | null;
  confidence: OfferingConfidence;
}

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function getContextWindow(text: string, matchIndex: number, matchLength: number): string {
  const start = Math.max(0, matchIndex - FIELD_CONTEXT_CHARS);
  const end = Math.min(text.length, matchIndex + matchLength + FIELD_CONTEXT_CHARS);
  return text.slice(start, end);
}

function getForwardContext(text: string, matchIndex: number, matchLength: number): string {
  const end = Math.min(text.length, matchIndex + matchLength + FIELD_CONTEXT_CHARS);
  return text.slice(matchIndex, end);
}

function parseScaledNumber(value: string, magnitude: string | undefined): number | null {
  const parsed = Number.parseFloat(value.replace(/,/g, ''));
  if (!Number.isFinite(parsed)) return null;

  const normalizedMagnitude = magnitude?.toLowerCase();
  if (normalizedMagnitude === 'million') return Math.round(parsed * 1_000_000);
  if (normalizedMagnitude === 'billion') return Math.round(parsed * 1_000_000_000);
  if (normalizedMagnitude === 'thousand') return Math.round(parsed * 1_000);
  return parsed;
}

function parseMonthDateToIso(value: string): string | null {
  const match = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/i.exec(value);
  if (!match?.[1] || !match[2] || !match[3]) return null;

  const month = MONTHS[match[1].toLowerCase()];
  if (!month) return null;

  const day = Number.parseInt(match[2], 10);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;

  return `${match[3]}-${month}-${String(day).padStart(2, '0')}`;
}

function looksLikeAuthorizedShareContext(text: string, matchIndex: number): boolean {
  const start = Math.max(0, matchIndex - 80);
  const end = Math.min(text.length, matchIndex + 120);
  const context = text.slice(start, end).toLowerCase();
  return /\bauthorized(?:\s+capital|\s+share\s+capital|\s+to\s+issue)?\b/.test(context);
}

function findMatchCrossingAnchor(
  context: string,
  pattern: RegExp,
  anchorIndex: number,
): RegExpExecArray | null {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const globalPattern = new RegExp(pattern.source, flags);

  for (const match of context.matchAll(globalPattern)) {
    const index = match.index ?? 0;
    const end = index + match[0].length;
    if (index <= anchorIndex && end >= anchorIndex) {
      return match as RegExpExecArray;
    }
  }

  return null;
}

export function findOfferingSection(text: string): string | null {
  if (!text.trim()) return null;

  const upperText = text.toUpperCase();
  for (const anchor of OFFERING_ANCHORS_424B) {
    const index = upperText.indexOf(anchor);
    if (index >= 0) {
      return text.slice(index, index + ANCHOR_WINDOW_CHARS);
    }
  }

  return text.slice(0, FALLBACK_SCAN_CHARS);
}

export function detectSellingStockholderResale(text: string): boolean {
  return /selling stockholders/i.test(text.slice(0, RESALE_DETECTION_CHARS));
}

export function extractDollarAmount(text: string, anchorPatterns: RegExp[]): number | null {
  for (const pattern of anchorPatterns) {
    const match = pattern.exec(text);
    if (!match) continue;

    const context = getForwardContext(text, match.index, match[0].length);
    const amountMatch = /\$\s*([\d,]+(?:\.\d+)?)\s*(million|billion)?/i.exec(context);
    if (!amountMatch?.[1]) continue;

    const parsed = parseScaledNumber(amountMatch[1], amountMatch[2]);
    if (parsed !== null) return parsed;
  }

  return null;
}

export function extractShareCount(text: string): number | null {
  // Equity-term group. Order matters within alternation: longer "shares of <X>
  // (common|capital|Class A/B common) stock" phrases come first so they win
  // over a bare "ordinary shares" fallback. Foreign issuers (e.g. CN ADRs)
  // file in "ordinary shares" / "ADSs" terminology; dual-class US issuers
  // use "Class A/B common stock"; some filers use "capital stock".
  const anchorPattern = /(?:shares?\s+of\s+(?:our\s+)?(?:Class\s+[AB]\s+common|common|capital)\s+stock|ordinary\s+shares|American\s+Depositary\s+Shares|ADSs?)/gi;
  const sharePattern = /([\d,]+(?:\.\d+)?)\s*(million|thousand)?\s+(?:shares?\s+of\s+(?:our\s+)?(?:Class\s+[AB]\s+common|common|capital)\s+stock|ordinary\s+shares|American\s+Depositary\s+Shares|ADSs?)/i;

  for (const anchorMatch of text.matchAll(anchorPattern)) {
    const index = anchorMatch.index ?? 0;
    const start = Math.max(0, index - FIELD_CONTEXT_CHARS);
    const context = getContextWindow(text, index, anchorMatch[0].length);
    const localAnchorIndex = index - start;
    const shareMatch = findMatchCrossingAnchor(context, sharePattern, localAnchorIndex);
    if (!shareMatch?.[1]) continue;
    if (looksLikeAuthorizedShareContext(context, shareMatch.index ?? 0)) continue;

    const parsed = parseScaledNumber(shareMatch[1], shareMatch[2]);
    if (parsed !== null) return parsed;
  }

  return null;
}

export function extractSecuritiesCount(text: string): number | null {
  const anchorPattern = /\b(?:shares?|units?|pre-funded\s+warrants?|securities)\b/gi;
  const securityPattern = /([\d,]+(?:\.\d+)?)\s*(million|thousand)?\s+(?:shares?|units?|pre-funded\s+warrants?|securities)\b/i;

  for (const anchorMatch of text.matchAll(anchorPattern)) {
    const index = anchorMatch.index ?? 0;
    const start = Math.max(0, index - FIELD_CONTEXT_CHARS);
    const context = getContextWindow(text, index, anchorMatch[0].length);
    const localAnchorIndex = index - start;
    const securityMatch = findMatchCrossingAnchor(context, securityPattern, localAnchorIndex);
    if (!securityMatch?.[1]) continue;
    if (looksLikeAuthorizedShareContext(context, securityMatch.index ?? 0)) continue;

    const parsed = parseScaledNumber(securityMatch[1], securityMatch[2]);
    if (parsed !== null) return parsed;
  }

  return null;
}

export function extractPricePerShare(text: string): number | null {
  // Per-unit price terms. ADS-issuing foreign filers quote "$X per ADS";
  // dual-class issuers quote "per Class A (common) share"; the original
  // (share|unit|pre-funded warrant|security) covers domestic single-class.
  const match = /\$\s*([\d,.]+)\s+per\s+(?:share|unit|pre-funded\s+warrant|security|ADS|ordinary\s+share|Class\s+[AB]\s+(?:common\s+)?share)/i.exec(text);
  if (!match?.[1]) return null;

  const parsed = Number.parseFloat(match[1].replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function extractWarrantsCount(text: string): number | null {
  const anchorPattern = /warrants?\s+to\s+purchase|warrants?\s+exercisable/gi;
  const warrantsPattern = /([\d,]+(?:\.\d+)?)\s*(million|thousand)?\s+warrants?/i;

  for (const anchorMatch of text.matchAll(anchorPattern)) {
    const index = anchorMatch.index ?? 0;
    const context = getContextWindow(text, index, anchorMatch[0].length);
    const warrantsMatch = warrantsPattern.exec(context);
    if (!warrantsMatch?.[1]) continue;

    const parsed = parseScaledNumber(warrantsMatch[1], warrantsMatch[2]);
    if (parsed !== null) return parsed;
  }

  return null;
}

function getSourceSnippet(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    return compactWhitespace(getContextWindow(text, match.index, match[0].length)).slice(0, 500);
  }

  const fallback = compactWhitespace(text).slice(0, 500);
  return fallback || null;
}

function extractDateNear(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const context = getContextWindow(text, match.index, match[0].length);
    const iso = parseMonthDateToIso(context);
    if (iso) return iso;
  }

  return null;
}

function inferOfferingStatus(text: string, isSellingStockholderResale: boolean): OfferingStatus {
  if (isSellingStockholderResale) return 'resale_only';
  if (/\b(?:terminated|termination|withdrawn|withdraws|cancelled|canceled|will\s+not\s+proceed)\b/i.test(text)) {
    return 'terminated';
  }
  if (/\b(?:closed|closing|completed|completion|consummated)\b[^.]{0,180}\b(?:offering|financing|placement|transaction|sale)\b/i.test(text)) {
    return 'closed';
  }
  if (/\b(?:offering|financing|placement|transaction|sale)\b[^.]{0,180}\b(?:closed|completed|consummated)\b/i.test(text)) {
    return 'closed';
  }
  if (/\bpriced\b[^.]{0,180}\b(?:offering|financing|placement|transaction)\b/i.test(text)) {
    return 'priced';
  }
  if (/\b(?:purchase|public\s+offering|offering)\s+price\b[^.]{0,120}\$\s*[\d,.]+/i.test(text)) {
    return 'priced';
  }
  if (/\b(?:announced|entered\s+into|commenced|launched|intends\s+to\s+offer|is\s+offering|are\s+offering|we\s+are\s+offering)\b/i.test(text)) {
    return 'announced';
  }

  return 'unknown';
}

function confidenceForStatus(status: OfferingStatus, hasNumericField: boolean): OfferingConfidence {
  if (status === 'closed' || status === 'priced' || status === 'terminated') return 'high';
  if (status === 'resale_only') return 'medium';
  if (status === 'announced' && hasNumericField) return 'medium';
  return 'low';
}

export function classifyOfferingType(
  bodyText: string,
  formType: string,
  item8K: '3.02' | '1.01' | null,
): OfferingType {
  if (item8K === '3.02') return 'PIPE';

  if (/at[-\s]the[-\s]market|\bATM\b/i.test(bodyText)) return 'ATM USED';
  if (/registered\s+direct/i.test(bodyText)) return 'REGISTERED DIRECT';
  if (/best\s+efforts/i.test(bodyText) && /placement\s+agent/i.test(bodyText)) return 'BEST EFFORTS';
  if (/private\s+placement|\bPIPE\b|securities\s+purchase\s+agreement/i.test(bodyText)) return 'PRIVATE PLACEMENT';
  if (/initial\s+public\s+offering|\bIPO\b/i.test(bodyText)) return 'IPO';
  if (/\bpublic\s+offering\b/i.test(bodyText)) return 'PUBLIC OFFERING';

  const normalizedFormType = formType.toUpperCase();
  if (/shelf\s+takedown/i.test(bodyText) || normalizedFormType === '424B5') return 'SHELF TAKEDOWN';
  if (normalizedFormType === '424B1' || normalizedFormType === '424B4') return 'PUBLIC OFFERING';

  return 'REGISTERED OFFERING';
}

function extractOfferingFieldsFromSection(args: {
  section: string;
  fullText: string;
  formType: string;
  item8K: '3.02' | '1.01' | null;
  forceStatus?: OfferingStatus;
  allowUnknownWithoutNumeric?: boolean;
}): ExtractedOfferingFields | null {
  const { section, fullText, formType, item8K, forceStatus, allowUnknownWithoutNumeric = false } = args;
  const isSellingStockholderResale = detectSellingStockholderResale(fullText);
  const offeringAmount = extractDollarAmount(section, [
    /gross\s+proceeds/i,
    /aggregate\s+gross\s+proceeds/i,
    /aggregate\s+offering\s+price/i,
    /total\s+proceeds/i,
    /aggregate\s+proceeds/i,
    /(?:total|aggregate)\s+purchase\s+price/i,
    /proceeds\s+(?:to\s+(?:the\s+)?(?:company|issuer)|from\s+the\s+offering)/i,
  ]);
  const netProceedsAmount = extractDollarAmount(section, [
    /net\s+proceeds/i,
    /estimated\s+net\s+proceeds/i,
  ]);
  const sharesAmount = extractShareCount(section);
  const securitiesAmount = sharesAmount ?? extractSecuritiesCount(section);
  const sharePrice = extractPricePerShare(section);
  const warrantsAmount = extractWarrantsCount(section);
  const offeringType = classifyOfferingType(section, formType, item8K);
  let status = forceStatus ?? inferOfferingStatus(section, isSellingStockholderResale);
  if (status === 'unknown' && sharePrice !== null) {
    status = 'priced';
  }
  const hasNumericField = [
    sharesAmount,
    securitiesAmount,
    sharePrice,
    offeringAmount,
    netProceedsAmount,
    warrantsAmount,
  ].some((value) => value !== null);

  if (
    !allowUnknownWithoutNumeric
    && status === 'unknown'
    && hasNumericField === false
    && offeringType === 'REGISTERED OFFERING'
  ) {
    return null;
  }

  return {
    status,
    offeringType,
    sharesAmount,
    securitiesAmount,
    sharePrice,
    offeringAmount,
    netProceedsAmount,
    warrantsAmount,
    isSellingStockholderResale,
    pricedDate: extractDateNear(section, [/\bpriced\b/i, /\boffering\s+price\b/i, /\bpurchase\s+price\b/i]),
    closedDate: extractDateNear(section, [/\bclosed\b/i, /\bclosing\b/i, /\bcompleted\b/i, /\bconsummated\b/i]),
    sourceSnippet: getSourceSnippet(section, [
      /\bclosed\b/i,
      /\bpriced\b/i,
      /\bgross\s+proceeds\b/i,
      /\bnet\s+proceeds\b/i,
      /\bshares?\s+of\s+(?:our\s+)?common\s+stock\b/i,
      /\bsecurities\s+purchase\s+agreement\b/i,
      /\bselling\s+stockholders?\b/i,
    ]),
    confidence: confidenceForStatus(status, hasNumericField),
  };
}

export function extractOfferingFrom424B(
  text: string,
  formType: string,
): ExtractedOfferingFields | null {
  const section = findOfferingSection(text);
  if (!section) return null;

  return extractOfferingFieldsFromSection({ section, fullText: text, formType, item8K: null });
}

export function extractOfferingFrom8K302(text: string): ExtractedOfferingFields | null {
  const anchorMatch = /Item\s+3\.02/i.exec(text);
  if (!anchorMatch) return null;

  const section = text.slice(anchorMatch.index, anchorMatch.index + ANCHOR_WINDOW_CHARS);

  return extractOfferingFieldsFromSection({
    section,
    fullText: text,
    formType: '8-K',
    item8K: '3.02',
    forceStatus: inferOfferingStatus(section, false) === 'unknown' ? 'announced' : undefined,
    allowUnknownWithoutNumeric: true,
  });
}

export function extractOfferingFrom8K101(text: string): ExtractedOfferingFields | null {
  const anchorMatch = /Item\s+1\.01/i.exec(text);
  if (!anchorMatch) return null;

  const section = text.slice(anchorMatch.index, anchorMatch.index + ANCHOR_WINDOW_CHARS);
  const hasOfferingAgreement = [
    /securities\s+purchase\s+agreement/i,
    /placement\s+agency\s+agreement/i,
    /at[-\s]the[-\s]market\s+(?:offering\s+)?agreement/i,
    /equity\s+distribution\s+agreement/i,
    /underwriting\s+agreement/i,
  ].some((pattern) => pattern.test(section));

  if (!hasOfferingAgreement) return null;

  return extractOfferingFieldsFromSection({
    section,
    fullText: text,
    formType: '8-K',
    item8K: '1.01',
    forceStatus: inferOfferingStatus(section, false) === 'unknown' ? 'announced' : undefined,
    allowUnknownWithoutNumeric: true,
  });
}

export function extractOfferingFrom8KOtherItem(text: string): ExtractedOfferingFields | null {
  const anchorMatch = /Item\s+(?:2\.03|7\.01|8\.01|9\.01)/i.exec(text);
  if (!anchorMatch) return null;

  const section = text.slice(anchorMatch.index, anchorMatch.index + ANCHOR_WINDOW_CHARS);
  const hasOfferingSignal = [
    /\b(?:offering|financing|placement|registered\s+direct|public\s+offering|private\s+placement)\b/i,
    /\b(?:gross|net)\s+proceeds\b/i,
    /\b(?:underwriting|placement\s+agency|securities\s+purchase)\s+agreement\b/i,
  ].some((pattern) => pattern.test(section));

  if (!hasOfferingSignal) return null;

  return extractOfferingFieldsFromSection({
    section,
    fullText: text,
    formType: '8-K',
    item8K: null,
  });
}

export function extractOfferingFromRegistrationForm(
  text: string,
  formType: string,
): ExtractedOfferingFields | null {
  const section = findOfferingSection(text);
  if (!section) return null;

  const hasRegistrationOfferingSignal = [
    /\b(?:we|company|issuer)\s+(?:are|is)\s+offering\b/i,
    /\b(?:gross|net)\s+proceeds\b/i,
    /\b(?:public\s+offering|registered\s+direct|private\s+placement|best\s+efforts|at[-\s]the[-\s]market)\b/i,
    /\bselling\s+stockholders?\b/i,
  ].some((pattern) => pattern.test(section) || pattern.test(text.slice(0, RESALE_DETECTION_CHARS)));

  if (!hasRegistrationOfferingSignal) return null;

  return extractOfferingFieldsFromSection({
    section,
    fullText: text,
    formType,
    item8K: null,
  });
}

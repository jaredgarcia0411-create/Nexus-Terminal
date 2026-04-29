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

export interface RawOffering {
  accessionNumber: string;
  formType: string;
  filedAt: string;
  url: string;
  offeringType: OfferingType;
  sharesAmount: number | null;
  sharePrice: number | null;
  offeringAmount: number | null;
  warrantsAmount: number | null;
  isSellingStockholderResale: boolean;
}

export interface ExtractedOfferingFields {
  offeringType: OfferingType;
  sharesAmount: number | null;
  sharePrice: number | null;
  offeringAmount: number | null;
  warrantsAmount: number | null;
  isSellingStockholderResale: boolean;
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
  if (normalizedMagnitude === 'million') return parsed * 1_000_000;
  if (normalizedMagnitude === 'billion') return parsed * 1_000_000_000;
  if (normalizedMagnitude === 'thousand') return parsed * 1_000;
  return parsed;
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
  const anchorPattern = /shares?\s+of\s+(?:our\s+)?common\s+stock/gi;
  const sharePattern = /([\d,]+(?:\.\d+)?)\s*(million|thousand)?\s+shares?\s+of\s+(?:our\s+)?common\s+stock/i;

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

export function extractPricePerShare(text: string): number | null {
  const match = /\$\s*([\d,.]+)\s+per\s+share/i.exec(text);
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

  const normalizedFormType = formType.toUpperCase();
  if (/shelf\s+takedown/i.test(bodyText) || normalizedFormType === '424B5') return 'SHELF TAKEDOWN';
  if (normalizedFormType === '424B1' || normalizedFormType === '424B4') return 'PUBLIC OFFERING';

  return 'REGISTERED OFFERING';
}

export function extractOfferingFrom424B(
  text: string,
  formType: string,
): ExtractedOfferingFields | null {
  const section = findOfferingSection(text);
  if (!section) return null;

  const isSellingStockholderResale = detectSellingStockholderResale(text);
  const offeringAmount = extractDollarAmount(section, [/gross\s+proceeds/i, /aggregate\s+offering\s+price/i]);
  const sharesAmount = extractShareCount(section);
  const sharePrice = extractPricePerShare(section);
  const warrantsAmount = extractWarrantsCount(section);
  const offeringType = classifyOfferingType(section, formType, null);

  if (
    sharesAmount === null
    && sharePrice === null
    && offeringAmount === null
    && warrantsAmount === null
    && offeringType === 'REGISTERED OFFERING'
    && isSellingStockholderResale === false
  ) {
    return null;
  }

  return {
    offeringType,
    sharesAmount,
    sharePrice,
    offeringAmount,
    warrantsAmount,
    isSellingStockholderResale,
  };
}

export function extractOfferingFrom8K302(text: string): ExtractedOfferingFields | null {
  const anchorMatch = /Item\s+3\.02/i.exec(text);
  if (!anchorMatch) return null;

  const section = text.slice(anchorMatch.index, anchorMatch.index + ANCHOR_WINDOW_CHARS);

  return {
    offeringType: 'PIPE',
    sharesAmount: extractShareCount(section),
    sharePrice: extractPricePerShare(section),
    offeringAmount: extractDollarAmount(section, [/gross\s+proceeds/i, /aggregate\s+offering\s+price/i]),
    warrantsAmount: extractWarrantsCount(section),
    isSellingStockholderResale: false,
  };
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

  return {
    offeringType: classifyOfferingType(section, '8-K', '1.01'),
    sharesAmount: extractShareCount(section),
    sharePrice: extractPricePerShare(section),
    offeringAmount: extractDollarAmount(section, [/gross\s+proceeds/i, /aggregate\s+offering\s+price/i]),
    warrantsAmount: extractWarrantsCount(section),
    isSellingStockholderResale: false,
  };
}

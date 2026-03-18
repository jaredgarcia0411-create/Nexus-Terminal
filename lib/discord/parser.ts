import { getMessageText, type DiscordMessage } from './client';

/** Structured data extracted from a research report */
export interface ParsedReportData {
  ticker: string;
  price: number | null;
  marketCap: string | null;
  floatShares: string | null;
  outstandingShares: string | null;
  industry: string | null;
  gainPercent: number | null;
  dilutionRisk: 'high' | 'medium' | 'low' | null;
  offeringRisk: 'high' | 'medium' | 'low' | null;
  scamRisk: 'high' | 'medium' | 'low' | null;
  cashBurnRisk: 'high' | 'medium' | 'low' | null;
}

/** Result of parsing a single Discord message */
export interface ParseResult {
  isReport: boolean;
  data: ParsedReportData | null;
}

const TICKER_REGEX = /Ultimate Research Report for ([A-Z]{1,5})/i;
const PRICE_REGEX = /Price:\s*\$?([\d,.]+)/i;
const MARKET_CAP_REGEX = /(?:Market\s*Cap|Mkt\s*Cap):\s*\$?([\d,.]+\s*[KMBT]?)/i;
const FLOAT_OS_REGEX = /Float\s*\/\s*OS:\s*\$?([\d,.]+\s*[KMBT]?)\s*\/\s*\$?([\d,.]+\s*[KMBT]?)/i;
const FLOAT_REGEX = /Float(?:\/OS)?:\s*\$?([\d,.]+\s*[KMBT]?)/i;
const OS_REGEX = /(?:OS|Outstanding(?:\s*Shares)?):\s*\$?([\d,.]+\s*[KMBT]?)/i;
const INDUSTRY_REGEX = /Industry:\s*(.+?)(?:\n|$)/i;
const GAIN_REGEX = /Gain:\s*[+-]?([\d,.]+)%/i;

function parseRiskLevel(text: string, sectionName: string): 'high' | 'medium' | 'low' | null {
  const lines = text.split('\n');
  const sectionIndex = lines.findIndex((line) => line.toLowerCase().includes(sectionName.toLowerCase()));
  if (sectionIndex === -1) return null;

  const snippet = lines.slice(sectionIndex, sectionIndex + 3).join('\n');

  if (snippet.includes('🔴') || snippet.includes(':red_circle:')) return 'high';
  if (snippet.includes('🟡') || snippet.includes(':yellow_circle:')) return 'medium';
  if (snippet.includes('🟢') || snippet.includes(':green_circle:')) return 'low';

  const upperSnippet = snippet.toUpperCase();
  if (upperSnippet.includes('HIGH')) return 'high';
  if (upperSnippet.includes('MEDIUM') || upperSnippet.includes('MODERATE')) return 'medium';
  if (upperSnippet.includes('LOW') || upperSnippet.includes('MINIMAL')) return 'low';

  return null;
}

/**
 * Parse a single Discord message into structured report data.
 *
 * Returns { isReport: false } for messages that are not research reports.
 * Returns { isReport: true, data: {...} } for valid reports, with null
 * for any fields that could not be extracted.
 */
export function parseReport(messageContent: string): ParseResult {
  const tickerMatch = messageContent.match(TICKER_REGEX);
  if (!tickerMatch) {
    return { isReport: false, data: null };
  }

  const ticker = tickerMatch[1].toUpperCase();
  const priceMatch = messageContent.match(PRICE_REGEX);
  const marketCapMatch = messageContent.match(MARKET_CAP_REGEX);
  const floatOsMatch = messageContent.match(FLOAT_OS_REGEX);
  const floatMatch = messageContent.match(FLOAT_REGEX);
  const osMatch = messageContent.match(OS_REGEX);
  const industryMatch = messageContent.match(INDUSTRY_REGEX);
  const gainMatch = messageContent.match(GAIN_REGEX);

  const dilutionRisk = parseRiskLevel(messageContent, 'dilution');
  const offeringRisk = parseRiskLevel(messageContent, 'offering');
  const scamRisk = parseRiskLevel(messageContent, 'scam');
  const cashBurnRisk = parseRiskLevel(messageContent, 'cash');

  const data: ParsedReportData = {
    ticker,
    price: priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : null,
    marketCap: marketCapMatch ? marketCapMatch[1].trim() : null,
    floatShares: floatOsMatch ? floatOsMatch[1].trim() : floatMatch ? floatMatch[1].trim() : null,
    outstandingShares: floatOsMatch ? floatOsMatch[2].trim() : osMatch ? osMatch[1].trim() : null,
    industry: industryMatch ? industryMatch[1].trim() : null,
    gainPercent: gainMatch ? parseFloat(gainMatch[1].replace(/,/g, '')) : null,
    dilutionRisk,
    offeringRisk,
    scamRisk,
    cashBurnRisk,
  };

  return { isReport: true, data };
}

export function parseMessages(
  messages: DiscordMessage[],
): Array<{ messageId: string; timestamp: string; data: ParsedReportData; rawText: string }> {
  const results: Array<{ messageId: string; timestamp: string; data: ParsedReportData; rawText: string }> = [];

  for (const msg of messages) {
    const text = getMessageText(msg);
    const result = parseReport(text);

    if (result.isReport && result.data) {
      results.push({
        messageId: msg.id,
        timestamp: msg.timestamp,
        data: result.data,
        rawText: text,
      });
    }
  }

  return results;
}

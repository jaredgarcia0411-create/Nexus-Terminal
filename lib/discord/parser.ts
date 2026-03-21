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

/** A named section from a Discord research report with optional risk level */
export interface ParsedReportSection {
  title: string;
  risk: 'high' | 'medium' | 'low' | null;
  content: string;
  bullets: string[];
}

/** Structured historical stats from the report footer */
export interface ParsedReportStats {
  prArticles: number | null;
  prMonths: number | null;
  prPerMonth: number | null;
  move20PctCount: number | null;
  move20PctPct: number | null;
  move50PctCount: number | null;
  move50PctPct: number | null;
  gapCount: number | null;
  gapRange: string | null;
  gapMedian: number | null;
  gapMean: number | null;
  openToHigh: number | null;
  openToLow: number | null;
  openToClose: number | null;
  fadeRate: number | null;
  closeBelowVwap: number | null;
  nhodAfter11am: number | null;
  brokePmh: number | null;
}

/** Full parsed report with all narrative sections — extends ParsedReportData for backward compat */
export interface ParsedReportFull extends ParsedReportData {
  newsWhyRunning: ParsedReportSection | null;
  theme: ParsedReportSection | null;
  otherCatalysts: ParsedReportSection | null;
  chartHistory: ParsedReportSection | null;
  dilutionDetails: ParsedReportSection | null;
  offeringFrequency: ParsedReportSection | null;
  offeringAbility: ParsedReportSection | null;
  cashNeedDetails: ParsedReportSection | null;
  managementCommentary: string | null;
  overallOfferingRisk: ParsedReportSection | null;
  jmt415Commentary: string | null;
  historicalStats: ParsedReportStats | null;
  dataSources: string[];
}

/** Result of parsing a single Discord message */
export interface ParseResult {
  isReport: boolean;
  data: ParsedReportFull | null;
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

/** Known section headers in Discord research reports, in typical order */
const SECTION_MARKERS: Array<{ key: keyof Omit<ParsedReportFull, keyof ParsedReportData>; pattern: RegExp }> = [
  { key: 'newsWhyRunning', pattern: /^[\s*]*News\s*\/?\s*Why/im },
  { key: 'theme', pattern: /^[\s*]*Theme/im },
  { key: 'otherCatalysts', pattern: /^[\s*]*Other\s*Catalysts/im },
  { key: 'chartHistory', pattern: /^[\s*]*Chart\s*History/im },
  { key: 'dilutionDetails', pattern: /^[\s*]*Dilution(?!\s*Rating)/im },
  { key: 'offeringFrequency', pattern: /^[\s*]*Offering\s*Frequency/im },
  { key: 'offeringAbility', pattern: /^[\s*]*Offering\s*Ability/im },
  { key: 'cashNeedDetails', pattern: /^[\s*]*Cash\s*Need/im },
  { key: 'managementCommentary', pattern: /^[\s*]*(?:Commentary|Management\s*Commentary|Commentary\s*on)/im },
  { key: 'overallOfferingRisk', pattern: /^[\s*]*Overall\s*Offering\s*Risk/im },
  { key: 'jmt415Commentary', pattern: /^[\s*]*Jmt415/im },
  { key: 'historicalStats', pattern: /^[\s*]*Historical\s*Stats/im },
];

const DATA_SOURCES_REGEX = /Data\s*Sources:\s*\n((?:.*(?:Fundamental|Chart|Market|Technical|Sentiment).*\n?)+)/im;
const BULLET_REGEX = /^[\s]*[\u2022\-\u2022\u2023\u25E6\u2043*]\s*/;

function parseSection(text: string): ParsedReportSection {
  const lines = text.split('\n');
  const titleLine = lines[0] ?? '';
  let risk: 'high' | 'medium' | 'low' | null = null;
  if (titleLine.includes('\uD83D\uDD34') || titleLine.includes(':red_circle:')) risk = 'high';
  else if (titleLine.includes('\uD83D\uDFE1') || titleLine.includes(':yellow_circle:') || titleLine.includes('\uD83D\uDFE0')) risk = 'medium';
  else if (titleLine.includes('\uD83D\uDFE2') || titleLine.includes(':green_circle:')) risk = 'low';

  if (!risk) {
    const upper = titleLine.toUpperCase();
    if (upper.includes('HIGH')) risk = 'high';
    else if (upper.includes('MEDIUM') || upper.includes('MODERATE')) risk = 'medium';
    else if (upper.includes('LOW') || upper.includes('MINIMAL')) risk = 'low';
  }

  const contentLines = lines.slice(1).filter((line) => line.trim().length > 0);
  const bullets: string[] = [];
  const nonBulletLines: string[] = [];

  for (const line of contentLines) {
    if (BULLET_REGEX.test(line)) {
      bullets.push(line.replace(BULLET_REGEX, '').trim());
    } else {
      nonBulletLines.push(line.trim());
    }
  }

  const title = titleLine.replace(/\*\*/g, '').replace(/[\u{1F534}\u{1F7E1}\u{1F7E0}\u{1F7E2}]/gu, '').trim();

  return {
    title,
    risk,
    content: nonBulletLines.join('\n').trim(),
    bullets,
  };
}

function parseHistoricalStats(text: string): ParsedReportStats {
  const num = (regex: RegExp, group = 1): number | null => {
    const match = text.match(regex);
    if (!match || !match[group]) return null;
    const value = parseFloat(match[group].replace(/,/g, ''));
    return Number.isFinite(value) ? value : null;
  };
  const str = (regex: RegExp, group = 1): string | null => {
    const match = text.match(regex);
    return match?.[group]?.trim() ?? null;
  };

  return {
    prArticles: num(/PR\s*History:\s*(\d+)\s*articles/i),
    prMonths: num(/PR\s*History:\s*\d+\s*articles\s*\/\s*(\d+)\s*months/i),
    prPerMonth: num(/PR\s*History:\s*\d+\s*articles\s*\/\s*\d+\s*months\s*\(([\d.]+)\/mo\)/i),
    move20PctCount: num(/20%\+\s*move\s*after\s*PR:\s*(\d+)/i),
    move20PctPct: num(/20%\+\s*move\s*after\s*PR:\s*\d+\s*\(([\d.]+)%?\)/i),
    move50PctCount: num(/50%\+\s*move\s*after\s*PR:\s*(\d+)/i),
    move50PctPct: num(/50%\+\s*move\s*after\s*PR:\s*\d+\s*\(([\d.]+)%?\)/i),
    gapCount: num(/Gap\s*History:\s*(\d+)\s*gaps/i),
    gapRange: str(/Range:\s*([\d.]+%\s*-\s*[\d.]+%)/i),
    gapMedian: num(/Median:\s*([\d.]+)%/i),
    gapMean: num(/Mean:\s*([\d.]+)%/i),
    openToHigh: num(/Open.{1,3}High:\s*([+-]?[\d.]+)%/i),
    openToLow: num(/Open.{1,3}Low:\s*([+-]?[\d.]+)%/i),
    openToClose: num(/Open.{1,3}Close:\s*([+-]?[\d.]+)%/i),
    fadeRate: num(/Fade\s*\(close\s*<\s*open\):\s*([\d.]+)%/i),
    closeBelowVwap: num(/Close\s*<\s*VWAP:\s*([\d.]+)%/i),
    nhodAfter11am: num(/NHOD\s*after\s*11am:\s*([\d.]+)%/i),
    brokePmh: num(/Broke\s*PMH:\s*([\d.]+)%/i),
  };
}

function parseSections(text: string): Partial<ParsedReportFull> {
  const result: Partial<ParsedReportFull> = {};
  const sectionPositions: Array<{ key: keyof Omit<ParsedReportFull, keyof ParsedReportData>; index: number }> = [];

  for (const marker of SECTION_MARKERS) {
    const match = text.match(marker.pattern);
    if (match?.index !== undefined) {
      sectionPositions.push({ key: marker.key, index: match.index });
    }
  }

  sectionPositions.sort((a, b) => a.index - b.index);

  for (let index = 0; index < sectionPositions.length; index += 1) {
    const start = sectionPositions[index].index;
    const end = index + 1 < sectionPositions.length ? sectionPositions[index + 1].index : text.length;
    const sectionText = text.slice(start, end).trim();
    const key = sectionPositions[index].key;

    if (key === 'managementCommentary' || key === 'jmt415Commentary') {
      const lines = sectionText.split('\n').slice(1).filter((line) => line.trim().length > 0);
      result[key] = lines.join('\n').trim() as never;
    } else if (key === 'historicalStats') {
      result.historicalStats = parseHistoricalStats(sectionText);
    } else {
      result[key] = parseSection(sectionText) as never;
    }
  }

  const dataSourcesMatch = text.match(DATA_SOURCES_REGEX);
  if (dataSourcesMatch) {
    result.dataSources = dataSourcesMatch[1]
      .split('\n')
      .map((line) => line.replace(/^[\s\u2705\u2713\u2611]*/, '').trim())
      .filter((line) => line.length > 0);
  } else {
    result.dataSources = [];
  }

  return result;
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

  const sections = parseSections(messageContent);

  const data: ParsedReportFull = {
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
    newsWhyRunning: sections.newsWhyRunning ?? null,
    theme: sections.theme ?? null,
    otherCatalysts: sections.otherCatalysts ?? null,
    chartHistory: sections.chartHistory ?? null,
    dilutionDetails: sections.dilutionDetails ?? null,
    offeringFrequency: sections.offeringFrequency ?? null,
    offeringAbility: sections.offeringAbility ?? null,
    cashNeedDetails: sections.cashNeedDetails ?? null,
    managementCommentary: sections.managementCommentary ?? null,
    overallOfferingRisk: sections.overallOfferingRisk ?? null,
    jmt415Commentary: sections.jmt415Commentary ?? null,
    historicalStats: sections.historicalStats ?? null,
    dataSources: sections.dataSources ?? [],
  };

  return { isReport: true, data };
}

export function parseMessages(
  messages: DiscordMessage[],
): Array<{ messageId: string; timestamp: string; data: ParsedReportFull; rawText: string }> {
  const results: Array<{ messageId: string; timestamp: string; data: ParsedReportFull; rawText: string }> = [];

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

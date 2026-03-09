export type JarvisMode = 'daily-summary' | 'trade-analysis' | 'assistant' | 'macro-summary' | 'dilution-research';

export interface JarvisTradeInput {
  id: string;
  symbol: string;
  date: string | Date;
  netPnl?: number;
  pnl?: number;
  direction?: 'LONG' | 'SHORT';
  totalQuantity?: number;
  tags?: string[];
  notes?: string;
}

export interface JarvisRequest {
  mode?: JarvisMode;
  prompt?: string;
  ticker?: string;
  urls?: string[];
  sourcePackId?: string;
  trades?: JarvisTradeInput[];
}

export interface JarvisResponse {
  message: string;
  sourceSummary?: string;
  sources?: JarvisSourceContext[];
  warnings?: string[];
  structured?: JarvisStructuredResponse;
  macroSummary?: JarvisMacroSummaryOutput;
  dilutionReport?: DilutionResearchReport;
}

export interface JarvisStructuredResponse {
  tldr: string;
  findings: string[];
  actionSteps: string[];
  risks: string[];
}

export type MacroSummaryRegion = 'us' | 'eu' | 'asia' | 'global';

export interface JarvisMacroRegionSummary {
  region: MacroSummaryRegion;
  headline: string;
  details: string[];
  sentiment: 'bullish' | 'bearish' | 'neutral' | 'mixed';
}

export interface JarvisMacroSummaryOutput {
  date: string;
  overallSentiment: 'bullish' | 'bearish' | 'neutral' | 'mixed';
  regions: JarvisMacroRegionSummary[];
  keyRisks: string[];
}

export type RiskRating = 'High' | 'Medium' | 'Low' | '';

export type RiskLevel = 'high' | 'medium' | 'low' | '';

export interface DilutionReportHeader {
  price: number | null;
  marketCap: number | null;
  float: number | null;
  outstanding: number | null;
  country: string;
  industry: string;
  sector: string;
  isAdr: boolean;
  gain1d: number | null;
  gain7d: number | null;
  gain30d: number | null;
  volume: number | null;
  avgVolume: number | null;
  shortFloat: number | null;
  shortInterest: number | null;
  feeRate: number | null;
  insiderPercent: number | null;
  affiliatePercent: number | null;
  institutionsPercent: number | null;
}

export interface DilutionDataSourceCheck {
  endpoint: string;
  label: string;
  hasData: boolean;
  error?: string;
}

export interface DilutionNewsItem {
  title: string;
  summary: string;
  body: string;
  filedAt: string;
  formType: string;
  author: string;
  tags: string[];
  documentUrl: string;
  isNews: boolean;
}

export interface DilutionCatalystItem {
  type: string;
  description: string;
  date: string;
  risk?: string;
  source: 'news' | 'compliance';
}

export interface WarrantItem {
  details: string;
  amount: number | null;
  remaining: number | null;
  exercisePrice: number | null;
  registered: string;
  exercisableDate: string;
  expirationDate: string;
  filedAt: string;
}

export interface ConvertibleItem {
  details: string;
  conversionPrice: number | null;
  registered: string;
  convertibleDate: string;
  maturityDate: string;
  offeringAmount: number | null;
  debtRemaining: number | null;
  sharesRemaining: number | null;
  filedAt: string;
}

export interface DilutionSection {
  rating: RiskRating;
  description: string;
  warrantExercise: RiskRating;
  warrantExerciseDesc: string;
  warrants: WarrantItem[];
  convertibles: ConvertibleItem[];
}

export interface OfferingItem {
  headline: string;
  filedAt: string;
  formType: string;
  offeringType: string;
  sharesAmount: number | null;
  warrantsAmount: number | null;
  sharePrice: number | null;
  offeringAmount: number | null;
  conversionPrice: number | null;
}

export interface OfferingFrequencySection {
  rating: RiskRating;
  description: string;
  offerings: OfferingItem[];
}

export interface RegistrationItem {
  headline: string;
  filedAt: string;
  effectiveDate: string;
  expirationDate: string;
  effectiveStatus: boolean;
  offeringAmount: number | null;
  isAtm: boolean;
  bank: string;
  amountRemainingAtm: number | null;
  totalRaised: number | null;
  overBabyShelf: boolean;
}

export interface OfferingAbilitySection {
  rating: RiskRating;
  description: string;
  registrations: RegistrationItem[];
}

export interface CashNeedSection {
  rating: RiskRating;
  description: string;
  estimatedCash: number | null;
  cashBurn: number | null;
  cashRemainingMonths: number | null;
  totalDebt: number | null;
}

export interface OverallRiskSection {
  rating: RiskRating;
  regsho: boolean;
  nasdaqCompliance: RiskRating;
  nasdaqComplianceDesc: string;
}

export interface ScamRiskSection {
  countryRisk: RiskLevel;
  floatRisk: RiskLevel;
  underwriterRisk: RiskLevel;
  scamRisk: RiskLevel;
  scamDescription: string;
  liquidationHistory: string;
  numberOfLiquidations: number;
  lastLiquidationDate: string;
  ipoDate: string;
  lockUpExpiration: string;
  underwriters: string;
}

export interface AgreementItem {
  agreementType: string;
  investorNames: string;
  filedAt: string;
  registrationDeadline: number | null;
  effectiveDeadline: number | null;
  penalties: string;
  restrictionDate: string;
  durationInDays: number | null;
  participationPercentage: string;
  details: string;
}

export interface HistoricalFloatEntry {
  reportedDate: string;
  outstandingShares: number | null;
  float: number | null;
  tradableFloat: number | null;
  affiliatePercent: number | null;
  insiderPercent: number | null;
  institutionsPercent: number | null;
  formType: string;
}

export interface ReverseSplitEntry {
  executionDate: string;
  splitFrom: number;
  splitTo: number;
}

export interface DilutionResearchReport {
  ticker: string;
  generatedAt: string;
  header: DilutionReportHeader;
  dataSources: DilutionDataSourceCheck[];
  news: DilutionNewsItem[];
  catalysts: DilutionCatalystItem[];
  dilution: DilutionSection;
  offeringFrequency: OfferingFrequencySection;
  offeringAbility: OfferingAbilitySection;
  cashNeed: CashNeedSection;
  managementCommentary: string;
  overallOfferingRisk: OverallRiskSection;
  scamRisk: ScamRiskSection;
  agreements: AgreementItem[];
  historicalFloat: HistoricalFloatEntry[];
  reverseSplits: ReverseSplitEntry[];
}

export type JarvisSourceType = 'web_source' | 'trade_journal' | 'user_document' | 'cached_headline' | 'api_data';

export interface ScrapedChunk {
  sourceUrl: string;
  sourceHost: string;
  sourceTitle: string;
  sourceType?: JarvisSourceType;
  sourceTags?: string[];
  index: number;
  startToken: number;
  endToken: number;
  tokenCount: number;
  text: string;
  hash: string;
  relevance?: number;
  tickers: string[];
  publishedAt?: string;
  author?: string;
}

export interface JarvisSourceContext {
  url: string;
  title: string;
  host: string;
  sourceType?: JarvisSourceType;
  sourceTags?: string[];
  excerpt: string;
  relevance: number;
  publishedAt?: string;
  author?: string;
  tickers: string[];
}

export interface ScrapedSource {
  url: string;
  title: string;
  host: string;
  excerpt: string;
  scrapedAt: Date;
  blocked?: boolean;
  error?: string;
  publishedAt?: string;
  author?: string;
  body?: string;
  tickers?: string[];
}

export interface ScrapeResult {
  sources: ScrapedSource[];
  chunks: ScrapedChunk[];
  sourceContexts: JarvisSourceContext[];
  warnings: string[];
}

export function toJarvisTradeInput(trade: {
  id: string;
  symbol: string;
  date: string | Date;
  netPnl?: number;
  pnl?: number;
  direction?: 'LONG' | 'SHORT';
  totalQuantity?: number;
  tags?: string[];
  notes?: string;
}): JarvisTradeInput {
  return {
    id: trade.id,
    symbol: trade.symbol,
    date: trade.date,
    netPnl: trade.netPnl,
    pnl: trade.pnl,
    direction: trade.direction,
    totalQuantity: trade.totalQuantity,
    tags: trade.tags,
    notes: trade.notes,
  };
}

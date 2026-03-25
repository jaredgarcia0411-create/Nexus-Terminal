export type JarvisMode = 'chat' | 'research' | 'trade-analysis' | 'macro';

export type JarvisMemoryCategory = 'trade_insight' | 'user_preference' | 'strategy_note' | 'macro_fact';

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
  rMultiple?: number | null;
}

export interface JarvisStructuredResponse {
  tldr: string;
  findings: string[];
  actionSteps: string[];
  risks: string[];
}

export interface TradeAnalysisOutput {
  strengths: string[];
  weaknesses: string[];
  patterns: string[];
  action_items: string[];
}

export interface MacroSummaryOutput {
  headline: string;
  key_themes: string[];
  economic_calendar?: string[];
  risk_flags: string[];
  watchlist_notes: string[];
}

export type MacroSummaryRegion = 'us' | 'eu' | 'asia' | 'global';

export interface JarvisMacroRegionSummary {
  region: MacroSummaryRegion;
  headline: string;
  details: string[];
  sentiment: 'bullish' | 'bearish' | 'neutral' | 'mixed';
}

export interface JarvisMacroSummaryLegacyOutput {
  date: string;
  overallSentiment: 'bullish' | 'bearish' | 'neutral' | 'mixed';
  regions: JarvisMacroRegionSummary[];
  keyRisks: string[];
}

export type JarvisMacroSummaryOutput = JarvisMacroSummaryLegacyOutput | MacroSummaryOutput;

export interface JarvisSourceContext {
  url: string;
  title: string;
  host: string;
  sourceType?: 'trade_journal' | 'api_data';
  excerpt: string;
  relevance: number;
  tickers: string[];
}

export interface JarvisContext {
  user_trades: Array<{
    id: string;
    symbol: string;
    direction: 'LONG' | 'SHORT';
    pnl: number;
    r_multiple: number | null;
    date: string;
    notes?: string;
  }>;
  macro_summary: MacroSummaryOutput | null;
  memory: Array<{
    category: JarvisMemoryCategory;
    key: string;
    value: string;
    value_json: unknown;
  }>;
  report_data?: unknown;
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

export interface FilingTitleItem {
  accessionNumber: string;
  cik: string;
  ticker: string;
  headline: string;
  filedAt: string;
  fileNo: string;
  formType: string;
  documentUrl: string;
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
  filingTitles: FilingTitleItem[];
}

import {
  fetchAgreements,
  fetchDilutionData,
  fetchDilutionRating,
  fetchFloatOutstanding,
  fetchHistoricalFloatPro,
  fetchNasdaqCompliance,
  fetchNews,
  fetchOfferings,
  fetchPumpAndDumpTracker,
  fetchRegistrations,
  fetchReverseSplits,
  fetchScreenerByTicker,
  type AgreementResult,
  type AskEdgarResponse,
  type DilutionDataResult,
  type DilutionRatingResult,
  type FloatOutstandingResult,
  type HistoricalFloatResult,
  type NasdaqComplianceResult,
  type NewsResult,
  type OfferingResult,
  type PumpAndDumpResult,
  type RegistrationResult,
  type ReverseSplitResult,
  type ScreenerResult,
} from '@/lib/askedgar-client';
import {
  type AgreementItem,
  type ConvertibleItem,
  type DilutionCatalystItem,
  type DilutionDataSourceCheck,
  type DilutionNewsItem,
  type DilutionResearchReport,
  type HistoricalFloatEntry,
  type ReverseSplitEntry,
  type RiskLevel,
  type RiskRating,
  type ScrapedChunk,
  type WarrantItem,
} from '@/lib/jarvis-types';

type EndpointKey =
  | 'float-outstanding'
  | 'screener'
  | 'dilution-rating'
  | 'dilution-data'
  | 'offerings'
  | 'registrations'
  | 'news'
  | 'nasdaq-compliance'
  | 'pump-and-dump-tracker'
  | 'agreements'
  | 'historical-float-pro'
  | 'reverse-splits';

interface EndpointConfig {
  key: EndpointKey;
  label: string;
  run: () => Promise<AskEdgarResponse<unknown>>;
}

interface EndpointState {
  key: EndpointKey;
  label: string;
  response: AskEdgarResponse<unknown>;
  hasData: boolean;
}

const NEWS_FORM_TYPES = new Set(['news', 'grok', 'jmt415']);
const CATALYST_TAGS = new Set([
  'FDA',
  'Contracts',
  'Partnerships',
  'Mergers',
  'Acquisitions',
  'Clinical Trials',
  'Product Launches',
  'Expansion Plans',
  'License Agreements',
]);

function toRiskRating(value: string | undefined): RiskRating {
  if (value === 'High' || value === 'Medium' || value === 'Low') return value;
  return '';
}

function toRiskLevel(value: string | undefined): RiskLevel {
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  return '';
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function chunkHash(input: string) {
  const normalized = input.trim().toLowerCase();
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

function asEndpointState(result: PromiseSettledResult<AskEdgarResponse<unknown>>, config: EndpointConfig): EndpointState {
  if (result.status === 'fulfilled') {
    const hasData = result.value.status !== 'error' && Array.isArray(result.value.results) && result.value.results.length > 0;
    return {
      key: config.key,
      label: config.label,
      response: result.value,
      hasData,
    };
  }

  return {
    key: config.key,
    label: config.label,
    response: {
      status: 'error',
      count: 0,
      results: [],
      error: result.reason instanceof Error ? result.reason.message : 'Unknown AskEdgar error',
    },
    hasData: false,
  };
}

function endpointWarning(state: EndpointState): string | null {
  if (state.hasData) return null;
  if (state.response.error) {
    return `${state.label} unavailable: ${state.response.error}`;
  }
  return `${state.label} returned no data`;
}

function toDataSource(state: EndpointState): DilutionDataSourceCheck {
  return {
    endpoint: state.key,
    label: state.label,
    hasData: state.hasData,
    error: state.response.error,
  };
}

function buildSectionChunk(ticker: string, generatedAt: string, index: number, section: string, text: string): ScrapedChunk {
  const tokenCount = Math.max(1, text.split(/\s+/).filter(Boolean).length);
  return {
    sourceUrl: `askedgar://${ticker}/${section}`,
    sourceHost: 'askedgar.io',
    sourceTitle: `AskEdgar ${section}`,
    sourceType: 'api_data',
    sourceTags: ['dilution-research', section],
    index,
    startToken: 0,
    endToken: tokenCount,
    tokenCount,
    text,
    hash: chunkHash(`${ticker}:${section}:${text}`),
    relevance: 0.8,
    tickers: [ticker],
    publishedAt: generatedAt,
    author: 'askedgar-api',
  };
}

function stringifySection(name: string, value: unknown) {
  return `${name}\n${JSON.stringify(value, null, 2)}`;
}

export async function aggregateDilutionReport(ticker: string): Promise<{
  report: DilutionResearchReport;
  chunks: ScrapedChunk[];
  warnings: string[];
}> {
  const normalizedTicker = ticker.trim().toUpperCase();
  const generatedAt = new Date().toISOString();

  const endpointConfigs: EndpointConfig[] = [
    { key: 'float-outstanding', label: 'Float Outstanding', run: () => fetchFloatOutstanding(normalizedTicker) },
    { key: 'screener', label: 'Screener', run: () => fetchScreenerByTicker(normalizedTicker) },
    { key: 'dilution-rating', label: 'Dilution Rating', run: () => fetchDilutionRating(normalizedTicker) },
    { key: 'dilution-data', label: 'Dilution Data', run: () => fetchDilutionData(normalizedTicker) },
    { key: 'offerings', label: 'Offerings', run: () => fetchOfferings(normalizedTicker, 20) },
    { key: 'registrations', label: 'Registrations', run: () => fetchRegistrations(normalizedTicker) },
    { key: 'news', label: 'News', run: () => fetchNews(normalizedTicker, 20) },
    { key: 'nasdaq-compliance', label: 'Nasdaq Compliance', run: () => fetchNasdaqCompliance(normalizedTicker) },
    { key: 'pump-and-dump-tracker', label: 'Pump and Dump Tracker', run: () => fetchPumpAndDumpTracker(normalizedTicker) },
    { key: 'agreements', label: 'Agreements', run: () => fetchAgreements(normalizedTicker) },
    { key: 'historical-float-pro', label: 'Historical Float', run: () => fetchHistoricalFloatPro(normalizedTicker, 20) },
    { key: 'reverse-splits', label: 'Reverse Splits', run: () => fetchReverseSplits(normalizedTicker) },
  ];

  const settledResults = await Promise.allSettled(endpointConfigs.map((config) => config.run()));

  const endpointStates = settledResults.map((result, index) => asEndpointState(result, endpointConfigs[index]));
  const stateByKey = new Map(endpointStates.map((state) => [state.key, state]));
  const warnings = endpointStates.map(endpointWarning).filter((warning): warning is string => Boolean(warning));

  const floatResult = (stateByKey.get('float-outstanding')?.response.results?.[0] ?? null) as FloatOutstandingResult | null;
  const screenerResult = (stateByKey.get('screener')?.response.results?.[0] ?? null) as ScreenerResult | null;
  const ratingResult = (stateByKey.get('dilution-rating')?.response.results?.[0] ?? null) as DilutionRatingResult | null;
  const dilutionDataResults = (stateByKey.get('dilution-data')?.response.results ?? []) as DilutionDataResult[];
  const offeringsResults = (stateByKey.get('offerings')?.response.results ?? []) as OfferingResult[];
  const registrationsResults = (stateByKey.get('registrations')?.response.results ?? []) as RegistrationResult[];
  const newsResults = (stateByKey.get('news')?.response.results ?? []) as NewsResult[];
  const complianceResults = (stateByKey.get('nasdaq-compliance')?.response.results ?? []) as NasdaqComplianceResult[];
  const pumpAndDumpResult = (stateByKey.get('pump-and-dump-tracker')?.response.results?.[0] ?? null) as PumpAndDumpResult | null;
  const agreementsResults = (stateByKey.get('agreements')?.response.results ?? []) as AgreementResult[];
  const historicalFloatResults = (stateByKey.get('historical-float-pro')?.response.results ?? []) as HistoricalFloatResult[];
  const reverseSplitsResults = (stateByKey.get('reverse-splits')?.response.results ?? []) as ReverseSplitResult[];

  const news: DilutionNewsItem[] = newsResults.map((item) => ({
    title: asString(item.title),
    summary: asString(item.summary),
    body: asString(item.body),
    filedAt: asString(item.filed_at),
    formType: asString(item.form_type),
    author: asString(item.author),
    tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    documentUrl: asString(item.document_url),
    isNews: NEWS_FORM_TYPES.has(asString(item.form_type).toLowerCase()),
  }));

  const catalystsFromNews: DilutionCatalystItem[] = news
    .filter((item) => item.tags.some((tag) => CATALYST_TAGS.has(tag)))
    .map((item) => ({
      type: item.tags.find((tag) => CATALYST_TAGS.has(tag)) ?? 'Catalyst',
      description: item.title || item.summary || 'News catalyst',
      date: item.filedAt,
      source: 'news',
    }));

  const catalystsFromCompliance: DilutionCatalystItem[] = complianceResults.map((item) => ({
    type: asString(item.deficiency) || 'Compliance',
    description: asString(item.notes) || asString(item.status) || 'Nasdaq compliance update',
    date: asString(item.date),
    risk: asString(item.risk),
    source: 'compliance',
  }));

  const warrants: WarrantItem[] = dilutionDataResults
    .filter((item) => item.warrants_amount !== undefined)
    .map((item) => ({
      details: asString(item.details),
      amount: asNumber(item.warrants_amount),
      remaining: asNumber(item.warrants_remaining),
      exercisePrice: asNumber(item.warrants_exercise_price),
      registered: asString(item.registered),
      exercisableDate: asString(item.exercisable_date),
      expirationDate: asString(item.expiration_date),
      filedAt: asString(item.filed_at),
    }));

  const convertibles: ConvertibleItem[] = dilutionDataResults
    .filter((item) => item.conversion_price !== undefined)
    .map((item) => ({
      details: asString(item.details),
      conversionPrice: asNumber(item.conversion_price),
      registered: asString(item.registered),
      convertibleDate: asString(item.convertible_date),
      maturityDate: asString(item.maturity_date),
      offeringAmount: asNumber(item.offering_amount),
      debtRemaining: asNumber(item.convertible_debt_remaining),
      sharesRemaining: asNumber(item.underlying_shares_remaining),
      filedAt: asString(item.filed_at),
    }));

  const agreements: AgreementItem[] = agreementsResults.map((item) => ({
    agreementType: asString(item.agreement_type),
    investorNames: asString(item.investor_names),
    filedAt: asString(item.filed_at),
    registrationDeadline: asNumber(item.registration_deadline),
    effectiveDeadline: asNumber(item.effective_deadline),
    penalties: asString(item.penalties),
    restrictionDate: asString(item.restriction_date),
    durationInDays: asNumber(item.duration_in_days),
    participationPercentage: asString(item.participation_percentage),
    details: asString(item.details),
  }));

  const historicalFloat: HistoricalFloatEntry[] = historicalFloatResults
    .map((item) => ({
      reportedDate: asString(item.reported_date),
      outstandingShares: asNumber(item.outstanding_shares),
      float: asNumber(item.float),
      tradableFloat: asNumber(item.tradable_float),
      affiliatePercent: asNumber(item.affiliate_percent),
      insiderPercent: asNumber(item.insider_percent),
      institutionsPercent: asNumber(item.institutions_percent),
      formType: asString(item.form_type),
    }))
    .sort((a, b) => b.reportedDate.localeCompare(a.reportedDate));

  const reverseSplits: ReverseSplitEntry[] = reverseSplitsResults
    .filter((item) => typeof item.split_from === 'number' && typeof item.split_to === 'number')
    .map((item) => ({
      executionDate: asString(item.execution_date),
      splitFrom: item.split_from as number,
      splitTo: item.split_to as number,
    }));

  const report: DilutionResearchReport = {
    ticker: normalizedTicker,
    generatedAt,
    header: {
      price: asNumber(screenerResult?.price),
      marketCap: asNumber(screenerResult?.market_cap),
      float: asNumber(floatResult?.float),
      outstanding: asNumber(floatResult?.outstanding),
      country: asString(floatResult?.country),
      industry: asString(floatResult?.industry),
      sector: asString(floatResult?.sector),
      isAdr: Boolean(floatResult?.isadr),
      gain1d: asNumber(screenerResult?.gain_1_day),
      gain7d: asNumber(screenerResult?.gain_7_day),
      gain30d: asNumber(screenerResult?.gain_30_day),
      volume: asNumber(screenerResult?.today_volume),
      avgVolume: asNumber(screenerResult?.averagevolume),
      shortFloat: asNumber(screenerResult?.short_float),
      shortInterest: asNumber(screenerResult?.short_interest),
      feeRate: asNumber(screenerResult?.feerate),
      insiderPercent: asNumber(floatResult?.insider_percent),
      affiliatePercent: asNumber(floatResult?.affiliate_percent),
      institutionsPercent: asNumber(floatResult?.institutions_percent),
    },
    dataSources: endpointStates.map(toDataSource),
    news,
    catalysts: [...catalystsFromNews, ...catalystsFromCompliance],
    dilution: {
      rating: toRiskRating(ratingResult?.dilution),
      description: asString(ratingResult?.dilution_desc),
      warrantExercise: toRiskRating(ratingResult?.warrant_exercise),
      warrantExerciseDesc: asString(ratingResult?.warrant_exercise_desc),
      warrants,
      convertibles,
    },
    offeringFrequency: {
      rating: toRiskRating(ratingResult?.offering_frequency),
      description: asString(ratingResult?.offering_frequency_desc),
      offerings: offeringsResults.map((item) => ({
        headline: asString(item.headline),
        filedAt: asString(item.filed_at),
        formType: asString(item.form_type),
        offeringType: asString(item.offering_type),
        sharesAmount: asNumber(item.shares_amount),
        warrantsAmount: asNumber(item.warrants_amount),
        sharePrice: asNumber(item.share_price),
        offeringAmount: asNumber(item.offering_amount),
        conversionPrice: asNumber(item.conversion_price),
      })),
    },
    offeringAbility: {
      rating: toRiskRating(ratingResult?.offering_ability),
      description: asString(ratingResult?.offering_ability_desc),
      registrations: registrationsResults.map((item) => ({
        headline: asString(item.headline),
        filedAt: asString(item.filed_at),
        effectiveDate: asString(item.effective_date),
        expirationDate: asString(item.expiration_date),
        effectiveStatus: Boolean(item.effective_status),
        offeringAmount: asNumber(item.offering_amount),
        isAtm: Boolean(item.is_atm),
        bank: asString(item.bank),
        amountRemainingAtm: asNumber(item.amount_remaining_atm),
        totalRaised: asNumber(item.total_raised),
        overBabyShelf: Boolean(item.over_baby_shelf),
      })),
    },
    cashNeed: {
      rating: toRiskRating(ratingResult?.cash_need),
      description: asString(ratingResult?.cash_need_desc),
      estimatedCash: asNumber(ratingResult?.estimated_cash),
      cashBurn: asNumber(ratingResult?.cash_burn),
      cashRemainingMonths: asNumber(ratingResult?.cash_remaining_months),
      totalDebt: asNumber(ratingResult?.total_debt_final),
    },
    managementCommentary: asString(ratingResult?.mgmt_commentary),
    overallOfferingRisk: {
      rating: toRiskRating(ratingResult?.overall_offering_risk),
      regsho: Boolean(ratingResult?.regsho),
      nasdaqCompliance: toRiskRating(ratingResult?.nasdaq_compliance),
      nasdaqComplianceDesc: asString(ratingResult?.nasdaq_compliance_desc),
    },
    scamRisk: {
      countryRisk: toRiskLevel(pumpAndDumpResult?.country_risk),
      floatRisk: toRiskLevel(pumpAndDumpResult?.float_risk),
      underwriterRisk: toRiskLevel(pumpAndDumpResult?.underwriter_risk),
      scamRisk: toRiskLevel(pumpAndDumpResult?.scam_risk),
      scamDescription: asString(pumpAndDumpResult?.scam_description),
      liquidationHistory: asString(pumpAndDumpResult?.liquidation_history),
      numberOfLiquidations: asNumber(pumpAndDumpResult?.number_liquidations) ?? 0,
      lastLiquidationDate: asString(pumpAndDumpResult?.last_liquidation_date),
      ipoDate: asString(pumpAndDumpResult?.ipo_date),
      lockUpExpiration: asString(pumpAndDumpResult?.lock_up_expiration),
      underwriters: asString(pumpAndDumpResult?.underwriters),
    },
    agreements,
    historicalFloat,
    reverseSplits,
  };

  const sectionTexts: Array<[string, unknown]> = [
    ['header', report.header],
    ['data-sources', report.dataSources],
    ['news', report.news],
    ['catalysts', report.catalysts],
    ['dilution', report.dilution],
    ['offering-frequency', report.offeringFrequency],
    ['offering-ability', report.offeringAbility],
    ['cash-need', report.cashNeed],
    ['management-commentary', report.managementCommentary],
    ['overall-offering-risk', report.overallOfferingRisk],
    ['scam-risk', report.scamRisk],
    ['agreements', report.agreements],
    ['historical-float', report.historicalFloat],
    ['reverse-splits', report.reverseSplits],
  ];

  const chunks = sectionTexts.map(([section, value], index) =>
    buildSectionChunk(normalizedTicker, generatedAt, index, section, stringifySection(section, value)),
  );

  return { report, chunks, warnings };
}

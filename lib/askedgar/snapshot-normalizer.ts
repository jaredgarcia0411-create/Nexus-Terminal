import { decodeHtmlEntities, getField, toNumberValue, toRecord } from '@/lib/askedgar-utils';
import { bucketForFormType } from '@/lib/filings-bucket';
import type {
  ResearchSnapshotFull,
  ResearchSnapshotConvertibleNote,
  ResearchSnapshotFiling,
  ResearchSnapshotGapStat,
  ResearchSnapshotHistoricalFloatRow,
  ResearchSnapshotHistoricalTicker,
  ResearchSnapshotNewsItem,
  ResearchSnapshotOffering,
  ResearchSnapshotRegistration,
  ResearchSnapshotReverseSplit,
  ResearchSnapshotWarrant,
} from '@/lib/types';
import type { AskEdgarResponse, NormalizeAskEdgarOptions } from '@/lib/askedgar/types';

// Detects equity-line registrations by headline. Used in both the snapshot
// normalizer and the scanner-summary cache so they stay in sync.
//
// `spa` (Stock Purchase Agreement) needs a word boundary because it's only
// three letters and could otherwise match unrelated words. "standby" catches
// "Standby Equity Purchase Agreement" filings. "purchase agreement" stays as
// a substring check since it appears with various prefixes.
const EQUITY_LINE_HEADLINE_REGEX = /\b(equity line|eloc|spa|standby)\b|purchase agreement/;

export function isEquityLineHeadline(headline: string | null | undefined): boolean {
  if (!headline) return false;
  return EQUITY_LINE_HEADLINE_REGEX.test(headline.toLowerCase());
}

function getEndpointResponse(rawData: Record<string, AskEdgarResponse<unknown>>, keys: string[]): AskEdgarResponse<unknown> {
  for (const key of keys) {
    if (rawData[key]) return rawData[key];
  }
  return { status: 'error', count: 0, results: [], error: 'Endpoint not returned' };
}

function firstResult(rawData: Record<string, AskEdgarResponse<unknown>>, keys: string[]) {
  return toRecord(getEndpointResponse(rawData, keys).results[0]);
}

function getStringField(record: Record<string, unknown>, keys: string[]): string | null {
  const value = getField(record, keys);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return null;
}

function getBooleanField(record: Record<string, unknown>, keys: string[]): boolean {
  const value = getField(record, keys);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === 'yes' || normalized === 'y' || normalized === '1';
  }
  return false;
}

// Returns a direct SEC filing URL for a registration/warrant/convertible row.
// Prefers a top-level `document_url` when the API provides one; otherwise
// extracts and URL-decodes the `filingUrl=` query parameter from
// `askedgar_url` (the Ask Edgar viewer wraps the real SEC URL inside its
// own URL — that's where warrant rows store the link).
function extractDocumentUrl(row: Record<string, unknown>): string | null {
  const direct = getStringField(row, ['document_url', 'documentUrl', 'url']);
  if (direct) return direct;
  const askedgarUrl = getStringField(row, ['askedgar_url', 'askedgarUrl']);
  if (askedgarUrl) {
    const match = /[?&]filingUrl=([^&]+)/i.exec(askedgarUrl);
    if (match) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return null;
      }
    }
  }
  return null;
}

function detectFormType(row: Record<string, unknown>): string | null {
  // The /v1/registrations endpoint doesn't expose form_type as a top-level
  // field, but it encodes it in the askedgar_url query string, e.g.
  // `...&formType=S-1` or `...&formType=F-1`. That's the authoritative signal
  // — prefer it over the rare top-level field and headline-pattern fallbacks.
  const askedgarUrl = getStringField(row, ['askedgar_url', 'askedgarUrl']);
  if (askedgarUrl) {
    const match = /[?&]formType=([^&]+)/i.exec(askedgarUrl);
    if (match) return decodeURIComponent(match[1]).toUpperCase();
  }
  const formType = getStringField(row, ['form_type', 'formType']);
  if (formType) return formType.toUpperCase();
  const headline = (getStringField(row, ['headline', 'title']) ?? '').toUpperCase();
  if (headline.includes('S-1')) return 'S-1';
  if (headline.includes('F-1')) return 'F-1';
  if (headline.includes('S-3')) return 'S-3';
  if (headline.includes('F-3')) return 'F-3';
  return null;
}

function normalizeHeadline(row: Record<string, unknown>, fallback: string): string {
  // Most rows have a real `headline` or `title`. JMT-summary news rows
  // (form_type "jmt415" / "grok") leave both null and stash the actual content
  // in `summary`, often with the real headline wrapped in *asterisks*. Try the
  // bolded text first, then the trimmed summary itself, then the fallback.
  const direct = getStringField(row, ['headline', 'title']);
  if (direct) return decodeHtmlEntities(direct);
  const summary = getStringField(row, ['summary', 'body']);
  if (summary) {
    const bolded = summary.match(/\*([^*]+)\*/);
    return decodeHtmlEntities((bolded ? bolded[1] : summary).trim());
  }
  return fallback;
}

function dedupeByHeadline<T extends { headline: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const headline = row.headline.trim().toLowerCase();
    if (!headline || seen.has(headline)) return false;
    seen.add(headline);
    return true;
  });
}

function firstStringFromResults(
  results: unknown[],
  keys: string[],
): string | null {
  for (const item of results) {
    const value = getStringField(toRecord(item), keys);
    if (value) return value;
  }
  return null;
}

export function toRegistrationRow(row: Record<string, unknown>, fallback: string): ResearchSnapshotRegistration {
  return {
    headline: normalizeHeadline(row, fallback),
    filedAt: getStringField(row, ['filed_at', 'filedAt', 'date']),
    effectiveDate: getStringField(row, ['effective_date', 'effectiveDate']),
    expirationDate: getStringField(row, ['expiration_date', 'expirationDate']),
    isEffective: getBooleanField(row, ['effective_status', 'effectiveStatus']),
    offeringAmount: toNumberValue(getField(row, [
      'offering_amount',
      'offeringAmount',
      'line_amount',
      'lineAmount',
      'facility_amount',
      'facilityAmount',
      'capacity',
      'amount',
    ])),
    isAtm: getBooleanField(row, ['is_atm', 'isAtm']),
    bank: getStringField(row, ['bank']),
    amountRemainingAtm: toNumberValue(getField(row, [
      'amount_remaining_atm',
      'amountRemainingAtm',
      'amount_remaining',
      'amountRemaining',
      'remaining_amount',
      'remainingAmount',
      'remaining_capacity',
      'remainingCapacity',
      'available_amount',
      'availableAmount',
    ])),
    totalRaised: toNumberValue(getField(row, ['total_raised', 'totalRaised'])),
    overBabyShelf: getBooleanField(row, ['over_baby_shelf', 'overBabyShelf']),
    babyShelfRaisableAmount: toNumberValue(getField(row, ['baby_shelf_raisable_amount', 'babyShelfRaisableAmount'])),
    formType: detectFormType(row),
    status: getStringField(row, ['status', 'registration_status', 'registrationStatus', 'effective_status_label', 'effectiveStatusLabel']),
    documentUrl: extractDocumentUrl(row),
  };
}

export function normalizeAskEdgarResponse(
  rawData: Record<string, AskEdgarResponse<unknown>>,
  options: NormalizeAskEdgarOptions,
): ResearchSnapshotFull {
  const screener = firstResult(rawData, ['screener']);
  const dilutionRating = firstResult(rawData, ['dilution-rating', 'dilutionRating']);
  const dilutionData = getEndpointResponse(rawData, ['dilution-data', 'dilutionData']);
  const dilutionDataFirst = toRecord(dilutionData.results[0]);
  const compliance = firstResult(rawData, ['nasdaq-compliance', 'nasdaqCompliance']);

  const registrations = getEndpointResponse(rawData, ['registrations']).results.map((item, index) => (
    toRegistrationRow(toRecord(item), `Registration ${index + 1}`)
  ));

  const offeringEquityLines = getEndpointResponse(rawData, ['equity-lines', 'equityLines']).results.map((item, index) => {
    const row = toRecord(item);
    return toRegistrationRow(row, `Equity line ${index + 1}`);
  });

  const registrationEquityLines = registrations.filter((row) => {
    if (row.isAtm) return false;
    return isEquityLineHeadline(row.headline);
  });

  const offerings = (getEndpointResponse(rawData, ['offerings']).results as Record<string, unknown>[])
    .map((row) => ({
      headline: getStringField(row, ['headline']) ?? 'Offering',
      filedAt: getStringField(row, ['filed_at', 'filedAt']),
      offeringType: getStringField(row, ['offering_type', 'offeringType']),
      sharesAmount: toNumberValue(getField(row, ['shares_amount', 'sharesAmount'])),
      warrantsAmount: toNumberValue(getField(row, ['warrants_amount', 'warrantsAmount'])),
      sharePrice: toNumberValue(getField(row, ['share_price', 'sharePrice'])),
      offeringAmount: toNumberValue(getField(row, ['offering_amount', 'offeringAmount'])),
    } satisfies ResearchSnapshotOffering))
    .filter((row) => !String(row.offeringType ?? '').toUpperCase().includes('EQUITY LINE'));

  const equityLines = dedupeByHeadline([
    ...registrationEquityLines,
    ...offeringEquityLines,
  ]);

  // The /v1/news endpoint can still return news articles and filing-like rows,
  // but the Research Filings tab now prefers first-party SEC submissions
  // metadata from the SEC-backed `sec-filings` endpoint.
  // News bucket: ONLY actual news rows. Ask Edgar LLM summary rows like
  // `grok` and `jmt415` add payload cost and are not rendered as news.
  const NEWS_FORM_TYPES = new Set(['news']);
  // Filings fallback bucket from /v1/news: only forms we render from this path.
  const ALLOWED_NEWS_FILING_TYPES = new Set(['8-k', 's-1', '6-k', '6-k/a', 's-1/a']);
  const newsEndpointRows = getEndpointResponse(rawData, ['news']).results.map((item) => toRecord(item));

  const news: ResearchSnapshotNewsItem[] = newsEndpointRows
    .filter((row) => NEWS_FORM_TYPES.has((getStringField(row, ['form_type', 'formType']) ?? 'news').toLowerCase()))
    .map((row, index) => ({
      title: normalizeHeadline(row, `News item ${index + 1}`),
      summary: decodeHtmlEntities(getStringField(row, ['body', 'summary', 'details']) ?? ''),
      filedAt: getStringField(row, ['filedAt', 'filed_at', 'date']),
      formType: getStringField(row, ['formType', 'form_type', 'form', 'source']) ?? 'News',
      isNews: true,
    } satisfies ResearchSnapshotNewsItem));

  const newsFilingRows: ResearchSnapshotFiling[] = newsEndpointRows
    .filter((row) => ALLOWED_NEWS_FILING_TYPES.has((getStringField(row, ['form_type', 'formType']) ?? '').toLowerCase()))
    .map((row) => {
      const formType = getStringField(row, ['form_type', 'formType', 'form']) ?? 'unknown';
      const title = getStringField(row, ['headline', 'title', 'summary', 'primary_doc_description', 'primaryDocDescription'])
        ?? `${formType} filing`;
      return {
        formType,
        bucket: bucketForFormType(formType),
        title,
        filedAt: getStringField(row, ['filed_at', 'filedAt', 'date']),
        url: getStringField(row, ['document_url', 'documentUrl', 'url']),
        accessionNumber: getStringField(row, ['accession_number', 'accessionNumber', 'accn']),
      } satisfies ResearchSnapshotFiling;
    })
    .sort((a, b) => {
      if (!a.filedAt && !b.filedAt) return 0;
      if (!a.filedAt) return 1;
      if (!b.filedAt) return -1;
      return b.filedAt.localeCompare(a.filedAt);
    });

  const secFilingRows: ResearchSnapshotFiling[] = getEndpointResponse(rawData, ['sec-filings', 'filings']).results
    .map((item) => toRecord(item))
    .map((row) => {
      const formType = getStringField(row, ['form_type', 'formType', 'form']) ?? 'unknown';
      const title = getStringField(row, ['headline', 'title', 'primary_doc_description', 'primaryDocDescription'])
        ?? `${formType} filing`;
      return {
        formType,
        bucket: bucketForFormType(formType),
        title,
        filedAt: getStringField(row, ['filed_at', 'filedAt', 'filingDate', 'date']),
        url: getStringField(row, ['url', 'sec_url', 'secUrl', 'document_url', 'documentUrl']),
        accessionNumber: getStringField(row, ['accession_number', 'accessionNumber', 'accn']),
      } satisfies ResearchSnapshotFiling;
    })
    .sort((a, b) => {
      if (!a.filedAt && !b.filedAt) return 0;
      if (!a.filedAt) return 1;
      if (!b.filedAt) return -1;
      return b.filedAt.localeCompare(a.filedAt);
    });

  const filings = secFilingRows.length > 0 ? secFilingRows : newsFilingRows;

  const currentPrice = toNumberValue(getField(screener, ['price']));
  const warrants: ResearchSnapshotWarrant[] = dilutionData.results.reduce<ResearchSnapshotWarrant[]>((rows, item, index) => {
    const row = toRecord(item);
    const amount = toNumberValue(getField(row, ['warrants_amount']));
    if (amount === null) return rows;

    const prefundedCost = toNumberValue(getField(row, ['prefunded_cost']));
    rows.push({
      details: getStringField(row, ['details']) ?? `Warrant ${index + 1}`,
      amount,
      remaining: toNumberValue(getField(row, ['warrants_remaining'])),
      exercisePrice: toNumberValue(getField(row, ['warrants_exercise_price'])),
      prefundedCost,
      registered: getStringField(row, ['registered']),
      exercisableDate: getStringField(row, ['exercisable_date']),
      expirationDate: getStringField(row, ['expiration_date']),
      filedAt: getStringField(row, ['filed_at', 'filedAt', 'date']),
      isPrefunded: prefundedCost !== null && prefundedCost > 0,
      status: getStringField(row, ['status', 'warrant_status', 'warrantStatus', 'in_play_status', 'inPlayStatus']),
      documentUrl: extractDocumentUrl(row),
    });
    return rows;
  }, []);

  const convertibleNotes: ResearchSnapshotConvertibleNote[] = dilutionData.results.reduce<ResearchSnapshotConvertibleNote[]>((rows, item, index) => {
    const row = toRecord(item);
    const details = getStringField(row, [
      'convertibles',
      'convertibleNotes',
      'convertible_notes',
      'convertible_note',
      'convertibleNote',
      'convertible_note_details',
      'convertibleNoteDetails',
    ]);
    const principalAmount = toNumberValue(getField(row, [
      'convertible_principal_amount',
      'convertiblePrincipalAmount',
      'principal_amount',
      'principalAmount',
      'note_amount',
      'noteAmount',
    ]));
    const conversionPrice = toNumberValue(getField(row, [
      'conversion_price',
      'conversionPrice',
      'convertible_conversion_price',
      'convertibleConversionPrice',
    ]));
    const maturityDate = getStringField(row, ['maturity_date', 'maturityDate']);
    if (!details && principalAmount === null && conversionPrice === null && !maturityDate) {
      return rows;
    }

    rows.push({
      details: details ?? `Convertible note ${index + 1}`,
      principalAmount,
      conversionPrice,
      maturityDate,
      filedAt: getStringField(row, ['filed_at', 'filedAt', 'date']),
      status: getStringField(row, ['convertible_status', 'convertibleStatus', 'note_status', 'noteStatus', 'status']),
      documentUrl: extractDocumentUrl(row),
    });
    return rows;
  }, []);

  const historicalFloat: ResearchSnapshotHistoricalFloatRow[] = getEndpointResponse(rawData, ['historical-float-pro', 'historicalFloatPro']).results.map((item) => {
    const row = toRecord(item);
    return {
      date: getStringField(row, ['reportedDate', 'reported_date', 'date']),
      outstanding: toNumberValue(getField(row, ['outstandingShares', 'outstanding_shares', 'outstanding'])),
      float: toNumberValue(getField(row, ['float'])),
      tradableFloat: toNumberValue(getField(row, ['tradableFloat', 'tradable_float'])),
    } satisfies ResearchSnapshotHistoricalFloatRow;
  });

  const reverseSplits: ResearchSnapshotReverseSplit[] = getEndpointResponse(rawData, ['reverse-splits', 'reverseSplits']).results.map((item) => {
    const row = toRecord(item);
    const ratio = getStringField(row, ['ratio'])
      ?? `${getStringField(row, ['splitFrom', 'split_from']) ?? '--'}-for-${getStringField(row, ['splitTo', 'split_to']) ?? '--'}`;
    return {
      date: getStringField(row, ['executionDate', 'execution_date', 'effectiveDate', 'effective_date', 'date']),
      ratio,
    } satisfies ResearchSnapshotReverseSplit;
  });

  const historicalTickersResult = firstResult(rawData, ['historical-tickers', 'historicalTickers']);
  const historicalTickers: ResearchSnapshotHistoricalTicker[] = Array.isArray(historicalTickersResult.historical_tickers)
    ? (historicalTickersResult.historical_tickers as Record<string, unknown>[])
        .map((row) => ({
          ticker: getStringField(row, ['ticker']),
          dateChanged: getStringField(row, ['date_changed', 'dateChanged']),
        }))
        .filter((row): row is ResearchSnapshotHistoricalTicker => row.ticker !== null)
    : [];

  const gapStats: ResearchSnapshotGapStat[] = getEndpointResponse(rawData, ['gap-stats', 'gapStats']).results.map((item) => {
    const row = toRecord(item);
    const tags = Array.isArray(getField(row, ['all_tags', 'tags'])) ? (getField(row, ['all_tags', 'tags']) as string[]) : [];
    const formTypes = Array.isArray(getField(row, ['filing_types', 'form_types', 'formTypes'])) ? (getField(row, ['filing_types', 'form_types', 'formTypes']) as string[]) : [];
    return {
      date: getStringField(row, ['date']),
      gapPercentage: toNumberValue(getField(row, ['gap_percentage', 'gapPercentage'])),
      marketOpen: toNumberValue(getField(row, ['market_open', 'marketOpen'])),
      marketClose: toNumberValue(getField(row, ['market_close', 'marketClose'])),
      intradayHigh: toNumberValue(getField(row, ['high_price', 'intraday_high', 'intradayHigh'])),
      intradayLow: toNumberValue(getField(row, ['low_price', 'intraday_low', 'intradayLow'])),
      volume: toNumberValue(getField(row, ['volume'])),
      tags: [...tags, ...formTypes],
    } satisfies ResearchSnapshotGapStat;
  });

  return {
    ticker: options.ticker,
    fetchedAt: options.fetchedAt,
    companyName: options.companyName,
    warnings: options.warnings,
    header: {
      // market_cap_final is AE's canonical post-computation value; plain market_cap
      // can lag or carry a stale price. Prefer _final.
      marketCap: toNumberValue(getField(screener, ['market_cap_final', 'marketCapFinal', 'marketCap', 'market_cap'])),
      outstandingShares: toNumberValue(getField(screener, ['outstanding', 'outstandingShares', 'outstanding_shares', 'sharesOutstanding'])),
      // tradable_float is the "true" float (subtracts restricted/lock-up shares); plain `float`
      // includes them and overstates what's actually trading. AE's UI uses tradable_float — match it.
      float: toNumberValue(getField(screener, ['tradable_float', 'tradableFloat', 'float_shares', 'floatShares', 'float'])),
      exchange: getStringField(screener, ['exchange']),
      ipoDate: getStringField(screener, ['ipodate', 'ipo_date', 'ipoDate']),
      industry: getStringField(screener, ['industry']),
      country: getStringField(screener, ['country']),
      price: currentPrice,
      shortInterest: toNumberValue(getField(screener, ['shortInterest', 'short_interest'])),
      volume: toNumberValue(getField(screener, ['today_volume', 'volume', 'totalVolume'])),
      description: options.description ?? null,
    },
    dilutionRating: getStringField(dilutionRating, ['dilution', 'dilution_rating', 'rating', 'dilutionRating']),
    cashNeedRating: getStringField(dilutionRating, ['cash_need', 'cashNeed']),
    offeringFrequencyRating: getStringField(dilutionRating, ['offering_frequency', 'offeringFrequency']),
    offeringAbilityRating: getStringField(dilutionRating, ['offering_ability', 'offeringAbility']),
    warrantExerciseRating: getStringField(dilutionRating, ['warrant_exercise', 'warrantExercise']),
    overallRisk: getStringField(dilutionRating, ['overall_offering_risk', 'overallOfferingRisk', 'overall_risk', 'overallRisk']),
    regsho: getBooleanField(compliance, ['regsho']),
    nasdaqCompliance: getStringField(compliance, ['status', 'complianceStatus', 'rating', 'nasdaq_compliance', 'nasdaqCompliance']),
    dilutionDetails: {
      cashRemainingMonths: toNumberValue(getField(dilutionRating, ['cash_remaining_months', 'cashRemainingMonths']))
        ?? toNumberValue(getField(dilutionDataFirst, ['cashRemainingMonths', 'monthsRemaining'])),
      cashBurn: toNumberValue(getField(dilutionRating, ['cash_burn', 'cashBurn']))
        ?? toNumberValue(getField(dilutionDataFirst, ['cashBurn', 'burnRate'])),
      estimatedCash: toNumberValue(getField(dilutionRating, ['estimated_cash', 'estimatedCash']))
        ?? toNumberValue(getField(dilutionDataFirst, ['estimatedCash', 'cash', 'cashOnHand'])),
      managementCommentary: getStringField(dilutionRating, ['mgmt_commentary', 'managementCommentary', 'commentary']),
      cashNeedDescription: getStringField(dilutionRating, ['cash_need_desc', 'cashNeedDesc']),
      filedAt: getStringField(dilutionRating, ['filed_at', 'filedAt', 'lastUpdated']),
      warrantInfo: firstStringFromResults(dilutionData.results, ['warrantExercise', 'warrantInfo', 'warrant_exercise']),
      convertibles: firstStringFromResults(dilutionData.results, [
        'convertibles',
        'convertibleNotes',
        'convertible_notes',
        'convertible_note',
        'convertibleNote',
        'convertible_note_details',
        'convertibleNoteDetails',
      ]),
      authorizedShares: toNumberValue(getField(dilutionDataFirst, ['authorizedShares', 'authorized_shares'])),
      sharesAvailable: toNumberValue(getField(dilutionDataFirst, ['sharesAvailable', 'availableShares'])),
    },
    warrants,
    convertibleNotes,
    registrations,
    equityLines,
    offerings,
    news,
    filings,
    historicalFloat,
    reverseSplits,
    historicalTickers,
    gapStats,
    rawData,
  };
}

import { getField, toNumberValue, toRecord } from '@/lib/askedgar-utils';
import { bucketForFormType } from '@/lib/filings-bucket';
import type { RawOffering } from '@/lib/sec/offerings';
import type {
  ResearchSnapshotFull,
  ResearchSnapshotAgreement,
  ResearchSnapshotConvertibleNote,
  ResearchSnapshotFiling,
  ResearchSnapshotGapStat,
  ResearchSnapshotHistoricalFloatRow,
  ResearchSnapshotIdentityEvent,
  ResearchSnapshotIdentityEventType,
  ResearchSnapshotNewsItem,
  ResearchSnapshotOffering,
  ResearchSnapshotOwnershipGroup,
  ResearchSnapshotOwner,
  ResearchSnapshotRegistration,
  ResearchSnapshotReverseSplit,
  ResearchSnapshotSplitStatus,
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

function detectFormType(row: Record<string, unknown>): string | null {
  const formType = getStringField(row, ['form_type', 'formType']);
  if (formType) return formType.toUpperCase();
  const headline = (getStringField(row, ['headline', 'title']) ?? '').toUpperCase();
  if (headline.includes('S-1')) return 'S-1';
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
  if (direct) return direct;
  const summary = getStringField(row, ['summary', 'body']);
  if (summary) {
    const bolded = summary.match(/\*([^*]+)\*/);
    if (bolded) return bolded[1].trim();
    return summary.trim();
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

function normalizeIdentityEventTypes(value: unknown): ResearchSnapshotIdentityEventType[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<ResearchSnapshotIdentityEventType>([
    'ticker_change',
    'name_change',
    'cik_identity_continuity',
    'exchange_listing_change',
  ]);
  return value.filter((item): item is ResearchSnapshotIdentityEventType => (
    typeof item === 'string' && allowed.has(item as ResearchSnapshotIdentityEventType)
  ));
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
  };
}

function buildOfferingHeadline(row: {
  offeringType: string | null;
  sharesAmount: number | null;
  sharePrice: number | null;
  offeringAmount: number | null;
  formType: string;
}): string {
  const hasFields = row.sharesAmount !== null || row.sharePrice !== null || row.offeringAmount !== null;
  if (!hasFields) {
    const typeLabel = row.offeringType ?? 'Offering';
    const normalizedFormType = row.formType.toUpperCase();
    if (/^8-K(?:\/A)?$/.test(normalizedFormType)) {
      const itemCode = row.offeringType === 'PIPE' ? '3.02' : '1.01';
      return `${typeLabel} (${normalizedFormType} Item ${itemCode})`;
    }
    return `${typeLabel} (${row.formType})`;
  }

  const parts: string[] = [row.offeringType ?? 'Offering'];
  if (row.sharesAmount !== null) parts.push(`${row.sharesAmount.toLocaleString('en-US')} shares`);
  if (row.sharePrice !== null) parts.push(`@ $${row.sharePrice.toFixed(2)}`);
  if (row.offeringAmount !== null) {
    const amount = row.offeringAmount;
    const formatted = amount >= 1_000_000_000
      ? `$${(amount / 1_000_000_000).toFixed(1)}B`
      : amount >= 1_000_000
        ? `$${(amount / 1_000_000).toFixed(1)}M`
        : `$${amount.toLocaleString('en-US')}`;
    parts.push(formatted);
  }

  return parts.join(' — ');
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

  const offerings = dedupeByHeadline(
    (getEndpointResponse(rawData, ['offerings']).results as RawOffering[])
      .filter((row) => !row.isSellingStockholderResale && row.status !== 'resale_only')
      .map((row) => {
        return {
          headline: buildOfferingHeadline(row),
          filedAt: row.filedAt,
          offeringType: row.offeringType,
          sharesAmount: row.sharesAmount,
          warrantsAmount: row.warrantsAmount,
          sharePrice: row.sharePrice,
          offeringAmount: row.offeringAmount,
        } satisfies ResearchSnapshotOffering;
      })
      .filter((row) => !String(row.offeringType ?? '').toUpperCase().includes('EQUITY LINE')),
  );

  const equityLines = dedupeByHeadline([
    ...registrationEquityLines,
    ...offeringEquityLines,
  ]);

  // The /v1/news endpoint can still return news articles and filing-like rows,
  // but the Research Filings tab now prefers first-party SEC submissions
  // metadata from the SEC-backed `sec-filings` endpoint.
  const NON_FILING_FORM_TYPES = new Set(['news', 'grok', 'jmt415']);
  const newsEndpointRows = getEndpointResponse(rawData, ['news']).results.map((item) => toRecord(item));

  const news: ResearchSnapshotNewsItem[] = newsEndpointRows
    .filter((row) => NON_FILING_FORM_TYPES.has((getStringField(row, ['form_type', 'formType']) ?? 'news').toLowerCase()))
    .map((row, index) => ({
      title: normalizeHeadline(row, `News item ${index + 1}`),
      summary: getStringField(row, ['body', 'summary', 'details']) ?? '',
      filedAt: getStringField(row, ['filedAt', 'filed_at', 'date']),
      formType: getStringField(row, ['formType', 'form_type', 'form', 'source']) ?? 'News',
      isNews: true,
    } satisfies ResearchSnapshotNewsItem));

  const newsFilingRows: ResearchSnapshotFiling[] = newsEndpointRows
    .filter((row) => !NON_FILING_FORM_TYPES.has((getStringField(row, ['form_type', 'formType']) ?? 'news').toLowerCase()))
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
    });
    return rows;
  }, []);

  const ownershipGroups: ResearchSnapshotOwnershipGroup[] = getEndpointResponse(rawData, ['ownership']).results
    .map((group) => {
      const groupRecord = toRecord(group);
      const owners = (Array.isArray(groupRecord.owners) ? groupRecord.owners : [])
        .map((owner) => {
          const row = toRecord(owner);
          return {
            name: getStringField(row, ['owner_name', 'ownerName']) ?? 'Unknown owner',
            role: getStringField(row, ['title', 'owner_type', 'ownerType']) ?? '--',
            common: toNumberValue(getField(row, ['common_shares_amount', 'commonSharesAmount'])),
            preferred: toNumberValue(getField(row, ['preferred_shares_amount', 'preferredSharesAmount'])),
            options: toNumberValue(getField(row, ['options_amount', 'optionsAmount'])),
            warrants: toNumberValue(getField(row, ['warrants_amount', 'warrantsAmount'])),
          } satisfies ResearchSnapshotOwner;
        })
        .filter((owner) => owner.name !== 'Unknown owner' || owner.role !== '--');

      return {
        reportedDate: getStringField(groupRecord, ['reported_date', 'reportedDate']),
        owners,
      } satisfies ResearchSnapshotOwnershipGroup;
    })
    .filter((group) => group.owners.length > 0);

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
      ?? `${getStringField(row, ['splitFrom', 'split_from']) ?? '--'}:${getStringField(row, ['splitTo', 'split_to']) ?? '--'}`;
    return {
      date: getStringField(row, ['executionDate', 'execution_date', 'effectiveDate', 'effective_date', 'date']),
      ratio,
    } satisfies ResearchSnapshotReverseSplit;
  });

  const identityEvents: ResearchSnapshotIdentityEvent[] = getEndpointResponse(rawData, ['identity-events', 'identityEvents']).results.map((item) => {
    const row = toRecord(item);
    return {
      previousTicker: getStringField(row, ['previousTicker', 'previous_ticker']),
      currentTicker: getStringField(row, ['currentTicker', 'current_ticker', 'newTicker', 'new_ticker']),
      previousCompanyName: getStringField(row, ['previousCompanyName', 'previous_company_name', 'formerName', 'former_name']),
      currentCompanyName: getStringField(row, ['currentCompanyName', 'current_company_name', 'newCompanyName', 'new_company_name']),
      effectiveDate: getStringField(row, ['effectiveDate', 'effective_date', 'date']),
      exchangeMarket: getStringField(row, ['exchangeMarket', 'exchange_market', 'exchange', 'market']),
      eventTypes: normalizeIdentityEventTypes(getField(row, ['eventTypes', 'event_types'])),
      filedAt: getStringField(row, ['filedAt', 'filed_at']),
      formType: getStringField(row, ['formType', 'form_type']),
      accessionNumber: getStringField(row, ['accessionNumber', 'accession_number']),
      url: getStringField(row, ['url', 'secUrl', 'sec_url', 'documentUrl', 'document_url']),
    } satisfies ResearchSnapshotIdentityEvent;
  });

  const splitStatuses: ResearchSnapshotSplitStatus[] = getEndpointResponse(rawData, ['split-status', 'splitStatus']).results.map((item) => {
    const row = toRecord(item);
    return {
      actionType: getStringField(row, ['action_type', 'actionType']),
      splitFrom: toNumberValue(getField(row, ['split_from', 'splitFrom'])),
      splitTo: toNumberValue(getField(row, ['split_to', 'splitTo'])),
      voteDate: getStringField(row, ['vote_date', 'voteDate']),
      approvedDate: getStringField(row, ['approved_date', 'approvedDate']),
      effectiveDate: getStringField(row, ['effective_date', 'effectiveDate']),
      details: getStringField(row, ['details']),
      filedAt: getStringField(row, ['filed_at', 'filedAt']),
      formType: getStringField(row, ['form_type', 'formType']),
      documentUrl: getStringField(row, ['document_url', 'documentUrl']),
      lastUpdated: getStringField(row, ['last_updated', 'lastUpdated']),
    } satisfies ResearchSnapshotSplitStatus;
  });

  const agreements: ResearchSnapshotAgreement[] = getEndpointResponse(rawData, ['agreements']).results.map((item) => {
    const row = toRecord(item);
    return {
      type: getStringField(row, ['agreementType', 'agreement_type', 'type']),
      investor: getStringField(row, ['investorNames', 'investor_names', 'investor']),
      date: getStringField(row, ['filedAt', 'filed_at', 'date']),
      details: getStringField(row, ['details', 'summary']),
    } satisfies ResearchSnapshotAgreement;
  });

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
    ownershipGroups,
    historicalFloat,
    reverseSplits,
    identityEvents,
    splitStatuses,
    agreements,
    gapStats,
    rawData,
  };
}

'use client';

import { useMemo, useState } from 'react';

interface AskEdgarEndpointResponse {
  status: string;
  results: unknown[];
  error?: string;
}

interface Props {
  ticker: string;
  rawData: Record<string, AskEdgarEndpointResponse>;
}

type TabKey =
  | 'overview'
  | 'offering-ability'
  | 'dilution'
  | 'news-filings'
  | 'offerings'
  | 'history';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function toStringValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return 'N/A';
}

function toNumberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[$,%]/g, '').replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatNumber(value: unknown): string {
  const numeric = toNumberValue(value);
  return numeric === null ? 'N/A' : numeric.toLocaleString();
}

function formatMoney(value: unknown): string {
  const numeric = toNumberValue(value);
  if (numeric === null) return 'N/A';
  return `$${numeric.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatDate(value: unknown): string {
  if (typeof value !== 'string' || !value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

function getField(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record && record[key] !== null && record[key] !== undefined && record[key] !== '') {
      return record[key];
    }
  }
  return null;
}

// Extracts SEC form type (S-1, S-3, F-3) from a registration row.
// S-1 registrations are exempt from baby shelf limits — important for dilution tracking.
function detectFormType(row: Record<string, unknown>): string | null {
  const formType = getField(row, ['form_type', 'formType']);
  if (typeof formType === 'string' && formType) return formType.toUpperCase();
  const headline = String(getField(row, ['headline', 'title']) ?? '').toUpperCase();
  if (headline.includes('S-1')) return 'S-1';
  if (headline.includes('S-3')) return 'S-3';
  if (headline.includes('F-3')) return 'F-3';
  return null;
}

// Returns the baby shelf status badge for a registration row.
// Baby shelf rule: companies with float < $75M can only sell 1/3 of float via S-3 in 12 months.
// S-1 registrations bypass this entirely (how ELOCs like Yorkville work around it).
function babyShelfBadge(row: Record<string, unknown>): { label: string; colorClass: string } | null {
  const formType = detectFormType(row);
  const overBabyShelf = row.over_baby_shelf === true || row.overBabyShelf === true;
  const raisable = toNumberValue(getField(row, ['baby_shelf_raisable_amount', 'babyShelfRaisableAmount']));

  const GREEN = 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  const AMBER = 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  const RED = 'border-rose-500/30 bg-rose-500/10 text-rose-300';

  if (formType === 'S-1') return { label: 'S-1 Exempt', colorClass: GREEN };
  if (!overBabyShelf) return { label: 'No Baby Shelf', colorClass: GREEN };
  if (raisable !== null && raisable > 0) return { label: `Baby Shelf: ${formatMoney(raisable)} Left`, colorClass: AMBER };
  return { label: 'Baby Shelf Exhausted', colorClass: RED };
}

function riskClass(value: unknown): string {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized.includes('low') || normalized.includes('compliant') || normalized.includes('positive')) {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  }
  if (normalized.includes('medium') || normalized.includes('watch') || normalized.includes('warning')) {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  }
  if (normalized.includes('high') || normalized.includes('risk') || normalized.includes('non-compliant') || normalized.includes('negative')) {
    return 'border-rose-500/30 bg-rose-500/10 text-rose-300';
  }
  return 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300';
}

function endpoint(rawData: Record<string, AskEdgarEndpointResponse>, keys: string[]): AskEdgarEndpointResponse {
  for (const key of keys) {
    if (rawData[key]) return rawData[key];
  }
  return { status: 'error', results: [], error: 'Endpoint not returned' };
}

function hasData(source: AskEdgarEndpointResponse): boolean {
  return source.status !== 'error' && Array.isArray(source.results) && source.results.length > 0;
}

function NoDataBadge({ endpointData }: { endpointData: AskEdgarEndpointResponse }) {
  return (
    <span className="inline-flex rounded-md border border-zinc-700 bg-zinc-800/60 px-2 py-1 text-sm text-zinc-400">
      No data{endpointData.error ? ` (${endpointData.error})` : ''}
    </span>
  );
}

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'offering-ability', label: 'Offering Ability' },
  { key: 'dilution', label: 'Dilution' },
{ key: 'news-filings', label: 'News & Filings' },
  { key: 'offerings', label: 'Offerings' },
  { key: 'history', label: 'History' },
];

export default function ResearchReportSections({ ticker, rawData }: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  const data = useMemo(() => {
    const screener = endpoint(rawData, ['screener']);
    const dilutionRating = endpoint(rawData, ['dilution-rating', 'dilutionRating']);
    const dilutionData = endpoint(rawData, ['dilution-data', 'dilutionData']);
    const offerings = endpoint(rawData, ['offerings']);
    const registrations = endpoint(rawData, ['registrations']);
    const news = endpoint(rawData, ['news']);
    const filingTitles = endpoint(rawData, ['filing-titles', 'filingTitles']);
    const nasdaqCompliance = endpoint(rawData, ['nasdaq-compliance', 'nasdaqCompliance']);
    const pumpAndDump = endpoint(rawData, ['pump-and-dump-tracker', 'pumpAndDumpTracker']);
    const historicalFloat = endpoint(rawData, ['historical-float-pro', 'historicalFloatPro']);
    const reverseSplits = endpoint(rawData, ['reverse-splits', 'reverseSplits']);
    const agreements = endpoint(rawData, ['agreements']);
    const equityLines = endpoint(rawData, ['equity-lines', 'equityLines']);

    return {
      screener,
      dilutionRating,
      dilutionData,
      offerings,
      registrations,
      news,
      filingTitles,
      nasdaqCompliance,
      pumpAndDump,
      historicalFloat,
      reverseSplits,
      agreements,
      equityLines,
    };
  }, [rawData]);

  const screenerItem = toRecord(data.screener.results[0]);
  const dilutionItem = toRecord(data.dilutionRating.results[0]);
  const dilutionDataItem = toRecord(data.dilutionData.results[0]);
  const complianceItem = toRecord(data.nasdaqCompliance.results[0]);
  const pumpItem = toRecord(data.pumpAndDump.results[0]);

  // Equity lines from the offerings endpoint
  const offeringEquityLines = data.equityLines.results;

  // Also check registrations for equity line entries (headline mentions equity line, ELOC, or purchase agreement)
  const EQUITY_LINE_KEYWORDS = ['equity line', 'eloc', 'purchase agreement'];
  const registrationEquityLines = data.registrations.results.filter((item) => {
    const row = toRecord(item);
    const headline = String(getField(row, ['headline', 'title']) ?? '').toLowerCase();
    const isAtm = row.is_atm === true || row.isAtm === true;
    if (isAtm) return false;
    return EQUITY_LINE_KEYWORDS.some((kw) => headline.includes(kw));
  });

  // Combine both sources — registrations first (richer data), then offerings as fallback.
  // Deduplicate by headline so the same equity line doesn't appear twice.
  const seenHeadlines = new Set<string>();
  const equityLines = [...registrationEquityLines, ...offeringEquityLines].filter((item) => {
    const row = toRecord(item);
    const headline = String(getField(row, ['headline', 'title']) ?? '').toLowerCase().trim();
    if (!headline || seenHeadlines.has(headline)) return false;
    seenHeadlines.add(headline);
    return true;
  });

  const regularOfferings = data.offerings.results.filter((item) => {
    const row = toRecord(item);
    const type = String(getField(row, ['offeringType', 'offering_type', 'type']) ?? '').toUpperCase();
    return !type.includes('EQUITY LINE');
  });

  // Find ATM registrations
  const atmRegistrations = data.registrations.results.filter((item) => {
    const row = toRecord(item);
    return row.is_atm === true || row.isAtm === true;
  });

  return (
    <section className="flex flex-col">
      <div className="border-b border-white/10 px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`rounded px-2.5 py-1 text-sm transition-colors ${
                activeTab === tab.key ? 'bg-emerald-500 text-black' : 'text-white hover:bg-white/10'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-3 text-base">
        {activeTab === 'overview' ? (
          <div className="space-y-5 divide-y divide-white/5">
            {/* Risk Ratings — 6 inline badges in 3-col grid */}
            {hasData(data.dilutionRating) ? (
              <div>
                <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    { label: 'Offering Ability', keys: ['offering_ability', 'offeringAbility'] },
                    { label: 'Dilution', keys: ['dilution', 'dilution_rating'] },
                    { label: 'Offering Frequency', keys: ['offering_frequency', 'offeringFrequency'] },
                    { label: 'Cash Need', keys: ['cash_need', 'cashNeed'] },
                    { label: 'Warrant Exercise', keys: ['warrant_exercise', 'warrantExercise'] },
                    { label: 'Nasdaq Compliance', keys: ['nasdaq_compliance', 'nasdaqCompliance'] },
                  ].map((item) => {
                    const value = getField(dilutionItem, item.keys)
                      || (item.label === 'Nasdaq Compliance' ? getField(complianceItem, ['status', 'complianceStatus', 'rating']) : null);
                    const colorClass = riskClass(value);
                    // Extract dot color from the badge color class
                    const dotColor = colorClass.includes('emerald') ? 'bg-emerald-500'
                      : colorClass.includes('amber') ? 'bg-amber-500'
                      : colorClass.includes('rose') ? 'bg-rose-500'
                      : 'bg-zinc-500';
                    return (
                      <div key={item.label} className="flex items-center gap-2 py-1">
                        <span className="text-white">{item.label}</span>
                        <span className={`h-2 w-2 rounded-full ${dotColor}`} />
                        <span className={`rounded border px-2 py-0.5 text-sm font-medium ${colorClass}`}>
                          {toStringValue(value)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <NoDataBadge endpointData={data.dilutionRating} />
            )}

            {/* Cash Position — narrative sentence style */}
            {(() => {
              const months = getField(dilutionItem, ['cash_remaining_months', 'cashRemainingMonths'])
                ?? getField(dilutionDataItem, ['cashRemainingMonths', 'monthsRemaining']);
              const burn = getField(dilutionItem, ['cash_burn', 'cashBurn'])
                ?? getField(dilutionDataItem, ['cashBurn', 'burnRate']);
              const cash = getField(dilutionItem, ['estimated_cash', 'estimatedCash'])
                ?? getField(dilutionDataItem, ['estimatedCash', 'cash', 'cashOnHand']);
              if (!months && !burn && !cash) return null;
              return (
                <div className="pt-5">
                  <h4 className="mb-2 text-lg font-semibold text-zinc-200">Cash Position</h4>
                  <p className="text-zinc-300">
                    The company has ~<span className="font-bold text-zinc-100">{toStringValue(months)}</span> months of cash left
                    based on the quarterly cash burn of <span className="font-bold text-zinc-100">{formatMoney(burn)}</span>
                    {' '}and estimated current cash of <span className="font-bold text-zinc-100">{formatMoney(cash)}</span>
                  </p>
                </div>
              );
            })()}

            {/* Commentary on Financial Condition */}
            {(() => {
              const commentary = getField(dilutionItem, ['mgmt_commentary', 'managementCommentary', 'commentary']);
              const cashDesc = getField(dilutionItem, ['cash_need_desc', 'cashNeedDesc']);
              const filedAt = getField(dilutionItem, ['filed_at', 'filedAt', 'lastUpdated']);
              if (!commentary && !cashDesc) return null;
              return (
                <div className="pt-5">
                  <h4 className="mb-2 text-lg font-semibold text-zinc-200">Commentary on Financial Condition</h4>
                  <div className="space-y-2">
                    {cashDesc ? <p className="text-zinc-300">{toStringValue(cashDesc)}</p> : null}
                    {commentary ? <p className="text-zinc-300">{toStringValue(commentary)}</p> : null}
                    {filedAt ? <p className="text-sm text-zinc-500">Filed At: {formatDate(filedAt)}</p> : null}
                  </div>
                </div>
              );
            })()}

            {/* Market Stats — compact reference row */}
            {hasData(data.screener) ? (
              <div className="pt-5">
                <h4 className="mb-2 text-sm font-medium uppercase tracking-wider text-zinc-500">Market Stats</h4>
                <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-xs text-zinc-500">Price</p><p className="text-sm text-zinc-200">{formatMoney(getField(screenerItem, ['price']))}</p></div>
                  <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-xs text-zinc-500">Market Cap</p><p className="text-sm text-zinc-200">{formatMoney(getField(screenerItem, ['marketCap', 'market_cap']))}</p></div>
                  <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-xs text-zinc-500">Float</p><p className="text-sm text-zinc-200">{formatNumber(getField(screenerItem, ['float', 'floatShares', 'float_shares']))}</p></div>
                  <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-xs text-zinc-500">OS</p><p className="text-sm text-zinc-200">{formatNumber(getField(screenerItem, ['outstanding', 'outstandingShares', 'sharesOutstanding']))}</p></div>
                  <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-xs text-zinc-500">Short Interest</p><p className="text-sm text-zinc-200">{formatNumber(getField(screenerItem, ['shortInterest', 'short_interest']))}</p></div>
                  <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-xs text-zinc-500">Volume</p><p className="text-sm text-zinc-200">{formatNumber(getField(screenerItem, ['today_volume', 'volume', 'totalVolume']))}</p></div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {activeTab === 'offering-ability' ? (
          <div className="space-y-4">
            {/* ATM Programs */}
            {atmRegistrations.length > 0 ? (
              <div className="divide-y divide-white/5">
                <h4 className="pb-2 font-medium text-white">ATM Programs</h4>
                {atmRegistrations.map((item, index) => {
                  const row = toRecord(item);
                  const remaining = getField(row, ['amount_remaining_atm', 'amountRemainingAtm']);
                  const total = getField(row, ['offering_amount', 'offeringAmount']);
                  const raised = getField(row, ['total_raised', 'totalRaised']);
                  const bank = getField(row, ['bank']);
                  const effective = getField(row, ['effective_status', 'effectiveStatus']);
                  return (
                    <div key={`atm-${index}`} className="py-2">
                      <div className="flex items-center gap-2">
                        <span className={`rounded border px-2 py-0.5 text-xs font-medium ${effective ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-zinc-500/30 bg-zinc-500/10 text-zinc-400'}`}>
                          {effective ? 'Active' : 'Inactive'}
                        </span>
                        <span className="text-zinc-200">{toStringValue(getField(row, ['headline', 'title']))}</span>
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        <div><span className="text-zinc-500">Total Registered:</span> <span className="text-zinc-200">{formatMoney(total)}</span></div>
                        <div><span className="text-zinc-500">Raised So Far:</span> <span className="text-zinc-200">{formatMoney(raised)}</span></div>
                        <div className="flex items-center gap-2">
                          <span className="text-zinc-500">ATM Remaining:</span>
                          <span className="font-medium text-amber-300">{formatMoney(remaining)}</span>
                        </div>
                        {(() => {
                          const badge = babyShelfBadge(row);
                          if (!badge) return null;
                          return (
                            <div className="flex justify-end">
                              <span className={`rounded border px-2 py-0.5 text-sm font-medium whitespace-nowrap ${badge.colorClass}`}>{badge.label}</span>
                            </div>
                          );
                        })()}
                        {bank ? <div><span className="text-zinc-500">Bank:</span> <span className="text-zinc-200">{String(bank)}</span></div> : null}
                      </div>
                      <div className="mt-1 text-zinc-500">
                        Filed: {formatDate(getField(row, ['filed_at', 'filedAt']))} | Expires: {formatDate(getField(row, ['expiration_date', 'expirationDate']))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="py-2 text-zinc-400">No active ATM programs found</p>
            )}

            {/* Equity Lines — card layout matching ATM programs */}
            {equityLines.length > 0 ? (
              <div className="divide-y divide-white/5">
                <h4 className="pb-2 font-medium text-white">Equity Lines</h4>
                {equityLines.map((item, index) => {
                  const row = toRecord(item);
                  const remaining = getField(row, ['amount_remaining_atm', 'amountRemainingAtm']);
                  const total = getField(row, ['offering_amount', 'offeringAmount']);
                  const raised = getField(row, ['total_raised', 'totalRaised']);
                  const effective = getField(row, ['effective_status', 'effectiveStatus']);
                  const badge = babyShelfBadge(row);

                  return (
                    <div key={`el-${index}`} className="py-2">
                      <div className="flex items-center gap-2">
                        <span className={`rounded border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${effective ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-zinc-500/30 bg-zinc-500/10 text-zinc-400'}`}>
                          {effective ? 'Active' : 'Inactive'}
                        </span>
                        <span className="text-zinc-200">{toStringValue(getField(row, ['headline', 'title']))}</span>
                        {badge ? (
                          <span className={`ml-auto rounded border px-2 py-0.5 text-sm font-medium whitespace-nowrap ${badge.colorClass}`}>
                            {badge.label}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        <div><span className="text-zinc-500">Total Registered:</span> <span className="text-zinc-200">{formatMoney(total)}</span></div>
                        <div><span className="text-zinc-500">Raised So Far:</span> <span className="text-zinc-200">{formatMoney(raised)}</span></div>
                        <div><span className="text-zinc-500">Remaining:</span> <span className="font-medium text-amber-300">{formatMoney(remaining)}</span></div>
                      </div>
                      <div className="mt-1 text-zinc-500">
                        Filed: {formatDate(getField(row, ['filed_at', 'filedAt']))} | Expires: {formatDate(getField(row, ['expiration_date', 'expirationDate']))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="py-2 text-zinc-400">No equity lines found</p>
            )}

            {/* All Registrations table */}
            {hasData(data.registrations) ? (
              <div className="space-y-2">
                <h4 className="font-medium text-zinc-300">Shelf Registrations</h4>
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead>
                      <tr className="border-b border-white/10 text-zinc-400">
                        <th className="py-2 pr-3 text-left">Headline</th>
                        <th className="py-2 pr-3 text-left">ATM</th>
                        <th className="py-2 pr-3 text-left">Amount</th>
                        <th className="py-2 pr-3 text-left">Remaining</th>
                        <th className="py-2 pr-3 text-left">Baby Shelf</th>
                        <th className="py-2 text-left">Filed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.registrations.results.map((item, index) => {
                        const row = toRecord(item);
                        const isAtm = row.is_atm === true || row.isAtm === true;
                        const overBabyShelf = row.over_baby_shelf === true || row.overBabyShelf === true;
                        return (
                          <tr key={`registration-${index}`} className="border-b border-white/5 text-zinc-300">
                            <td className="py-2 pr-3">{toStringValue(getField(row, ['headline', 'title']))}</td>
                            <td className="py-2 pr-3">{isAtm ? <span className="text-amber-300">Yes</span> : 'No'}</td>
                            <td className="py-2 pr-3">{formatMoney(getField(row, ['offering_amount', 'offeringAmount']))}</td>
                            <td className="py-2 pr-3">{formatMoney(getField(row, ['amount_remaining_atm', 'amountRemainingAtm']))}</td>
                            <td className="py-2 pr-3">{overBabyShelf ? <span className="text-rose-300">Over Limit</span> : 'OK'}</td>
                            <td className="py-2">{formatDate(getField(row, ['filed_at', 'filedAt']))}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <NoDataBadge endpointData={data.registrations} />
            )}

            <div className="space-y-1">
              <h4 className="font-medium text-white">Management Commentary</h4>
              <p className="text-sm text-zinc-200">{toStringValue(getField(dilutionItem, ['mgmt_commentary', 'managementCommentary', 'commentary']))}</p>
            </div>
          </div>
        ) : null}

        {activeTab === 'dilution' ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className={`rounded border px-2 py-1 text-sm ${riskClass(getField(dilutionItem, ['rating', 'dilutionRating']))}`}>
                {toStringValue(getField(dilutionItem, ['rating', 'dilutionRating']))}
              </span>
              <span className="text-zinc-400">Dilution Rating</span>
            </div>
            {hasData(data.dilutionData) ? (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-zinc-500">Warrants</p><p className="text-zinc-200">{toStringValue(getField(dilutionDataItem, ['warrantExercise', 'warrantInfo', 'warrant_exercise']))}</p></div>
                <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-zinc-500">Convertibles</p><p className="text-zinc-200">{toStringValue(getField(dilutionDataItem, ['convertibles', 'convertibleNotes']))}</p></div>
                <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-zinc-500">Auth Shares</p><p className="text-zinc-200">{formatNumber(getField(dilutionDataItem, ['authorizedShares', 'authorized_shares']))}</p></div>
                <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-zinc-500">Available</p><p className="text-zinc-200">{formatNumber(getField(dilutionDataItem, ['sharesAvailable', 'availableShares']))}</p></div>
              </div>
            ) : (
              <NoDataBadge endpointData={data.dilutionData} />
            )}

            {/* Outstanding Warrants */}
            {(() => {
              const currentPrice = toNumberValue(getField(screenerItem, ['price']));
              const today = new Date().toISOString().slice(0, 10);

              const regularWarrants = data.dilutionData.results
                .map((item) => toRecord(item))
                .filter((row) => {
                  const hasWarrants = getField(row, ['warrants_amount']) !== null;
                  const prefunded = toNumberValue(getField(row, ['prefunded_cost']));
                  return hasWarrants && (prefunded === null || prefunded === 0);
                });

              if (regularWarrants.length === 0) {
                return (
                  <div className="space-y-2">
                    <h4 className="font-medium text-zinc-300">Outstanding Warrants</h4>
                    <p className="text-sm text-zinc-500">No outstanding warrants found</p>
                  </div>
                );
              }

              return (
                <div className="space-y-2">
                  <h4 className="font-medium text-zinc-300">Outstanding Warrants</h4>
                  <div className="overflow-x-auto">
                    <table className="min-w-full">
                      <thead>
                        <tr className="border-b border-white/10 text-zinc-400">
                          <th className="py-2 pr-3 text-left">Details</th>
                          <th className="py-2 pr-3 text-left">Remaining</th>
                          <th className="py-2 pr-3 text-left">Strike</th>
                          <th className="py-2 pr-3 text-left">Registered</th>
                          <th className="py-2 pr-3 text-left">Exercisable</th>
                          <th className="py-2 pr-3 text-left">Expires</th>
                          <th className="py-2 text-left">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {regularWarrants.map((row, index) => {
                          const exercisePrice = toNumberValue(getField(row, ['warrants_exercise_price']));
                          const exercisableDate = getField(row, ['exercisable_date']) as string | null;
                          const expirationDate = getField(row, ['expiration_date']) as string | null;
                          const registered = String(getField(row, ['registered']) ?? '');
                          const warrantsRemaining = toNumberValue(getField(row, ['warrants_remaining']));

                          let status: string;
                          let colorClass: string;

                          const RED = 'border-rose-500/30 bg-rose-500/10 text-rose-300';
                          const YELLOW = 'border-amber-500/30 bg-amber-500/10 text-amber-300';
                          const GREEN = 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';

                          // Fully exercised — no dilution risk
                          if (warrantsRemaining !== null && warrantsRemaining <= 0) {
                            status = 'Not In Play';
                            colorClass = RED;
                          } else if (exercisableDate === null) {
                            status = 'Not In Play';
                            colorClass = RED;
                          } else if (expirationDate && expirationDate < today) {
                            status = 'Not In Play';
                            colorClass = RED;
                          } else if (exercisableDate > today) {
                            status = 'Not In Play';
                            colorClass = RED;
                          } else if (registered !== 'Registered') {
                            status = 'Not In Play';
                            colorClass = RED;
                          } else if (currentPrice !== null && exercisePrice !== null && currentPrice >= exercisePrice) {
                            status = 'In Play';
                            colorClass = GREEN;
                          } else {
                            status = 'Potentially in Play';
                            colorClass = YELLOW;
                          }

                          return (
                            <tr key={`warrant-${index}`} className="border-b border-white/5">
                              <td className="py-2 pr-3 text-zinc-300">{toStringValue(getField(row, ['details']))}</td>
                              <td className="py-2 pr-3 text-zinc-200">{formatNumber(getField(row, ['warrants_remaining']))}</td>
                              <td className="py-2 pr-3 text-zinc-200">{formatMoney(getField(row, ['warrants_exercise_price']))}</td>
                              <td className="py-2 pr-3 text-zinc-300">{toStringValue(getField(row, ['registered']))}</td>
                              <td className="py-2 pr-3 text-zinc-300">{formatDate(getField(row, ['exercisable_date']))}</td>
                              <td className="py-2 pr-3 text-zinc-300">{formatDate(getField(row, ['expiration_date']))}</td>
                              <td className="py-2">
                                <span className={`rounded border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${colorClass}`}>
                                  {status}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}

            {/* Pre-funded Warrants */}
            {(() => {
              const prefundedWarrants = data.dilutionData.results
                .map((item) => toRecord(item))
                .filter((row) => {
                  const hasWarrants = getField(row, ['warrants_amount']) !== null;
                  const prefunded = toNumberValue(getField(row, ['prefunded_cost']));
                  return hasWarrants && prefunded !== null && prefunded > 0;
                });

              if (prefundedWarrants.length === 0) {
                return (
                  <div className="space-y-2">
                    <h4 className="font-medium text-zinc-300">Pre-funded Warrants</h4>
                    <p className="text-sm text-zinc-500">No pre-funded warrants found</p>
                  </div>
                );
              }

              return (
                <div className="space-y-2">
                  <h4 className="font-medium text-zinc-300">Pre-funded Warrants</h4>
                  <div className="overflow-x-auto">
                    <table className="min-w-full">
                      <thead>
                        <tr className="border-b border-white/10 text-zinc-400">
                          <th className="py-2 pr-3 text-left">Details</th>
                          <th className="py-2 pr-3 text-left">Remaining</th>
                          <th className="py-2 pr-3 text-left">Pre-funded Cost</th>
                          <th className="py-2 pr-3 text-left">Registered</th>
                          <th className="py-2 pr-3 text-left">Exercisable</th>
                          <th className="py-2 pr-3 text-left">Expires</th>
                          <th className="py-2 text-left">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {prefundedWarrants.map((row, index) => {
                          // Pre-funded warrants are always "Not In Play" — low exercise likelihood
                          const colorClass = 'border-rose-500/30 bg-rose-500/10 text-rose-300';
                          const status = 'Not In Play';

                          return (
                            <tr key={`prefunded-${index}`} className="border-b border-white/5">
                              <td className="py-2 pr-3 text-zinc-300">{toStringValue(getField(row, ['details']))}</td>
                              <td className="py-2 pr-3 text-zinc-200">{formatNumber(getField(row, ['warrants_remaining']))}</td>
                              <td className="py-2 pr-3 text-zinc-200">{formatMoney(getField(row, ['prefunded_cost']))}</td>
                              <td className="py-2 pr-3 text-zinc-300">{toStringValue(getField(row, ['registered']))}</td>
                              <td className="py-2 pr-3 text-zinc-300">{formatDate(getField(row, ['exercisable_date']))}</td>
                              <td className="py-2 pr-3 text-zinc-300">{formatDate(getField(row, ['expiration_date']))}</td>
                              <td className="py-2">
                                <span className={`rounded border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${colorClass}`}>
                                  {status}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
          </div>
        ) : null}

        {activeTab === 'news-filings' ? (
          <div className="space-y-2">
            {[...data.news.results.map((item) => ({ source: 'news', row: toRecord(item) })), ...data.filingTitles.results.map((item) => ({ source: 'filing', row: toRecord(item) }))]
              .map((item, index) => {
                const formType = toStringValue(getField(item.row, ['formType', 'form', 'source']));
                const sourceClass =
                  item.source === 'news'
                    ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
                    : formType.toLowerCase().includes('grok')
                      ? 'border-violet-500/30 bg-violet-500/10 text-violet-300'
                      : 'border-orange-500/30 bg-orange-500/10 text-orange-300';
                return (
                  <details key={`news-filing-${index}`} className="rounded border border-white/10 bg-white/5 p-2">
                    <summary className="cursor-pointer text-zinc-200">
                      {toStringValue(getField(item.row, ['headline', 'title']))}
                    </summary>
                    <div className="mt-2 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className={`rounded border px-2 py-0.5 text-sm ${sourceClass}`}>{formType}</span>
                        <span className="text-zinc-500">{formatDate(getField(item.row, ['filedAt', 'date']))}</span>
                      </div>
                      <p className="text-zinc-300">{toStringValue(getField(item.row, ['body', 'summary', 'details']))}</p>
                    </div>
                  </details>
                );
              })}
            {data.news.results.length === 0 && data.filingTitles.results.length === 0 ? <NoDataBadge endpointData={data.news} /> : null}
          </div>
        ) : null}

        {activeTab === 'offerings' ? (
          <div className="space-y-4">
            {/* Regular Offerings */}
            {regularOfferings.length > 0 ? (
              <div className="space-y-2">
                <h4 className="font-medium text-zinc-300">Offerings</h4>
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead>
                      <tr className="border-b border-white/10 text-zinc-400">
                        <th className="py-2 pr-3 text-left">Date</th>
                        <th className="py-2 pr-3 text-left">Type</th>
                        <th className="py-2 pr-3 text-left">Shares</th>
                        <th className="py-2 pr-3 text-left">Price</th>
                        <th className="py-2 text-left">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {regularOfferings.map((item, index) => {
                        const row = toRecord(item);
                        return (
                          <tr key={`offering-${index}`} className="border-b border-white/5 text-zinc-300">
                            <td className="py-2 pr-3">{formatDate(getField(row, ['filed_at', 'filedAt', 'date']))}</td>
                            <td className="py-2 pr-3">{toStringValue(getField(row, ['offeringType', 'offering_type', 'type', 'formType']))}</td>
                            <td className="py-2 pr-3">{formatNumber(getField(row, ['shares_amount', 'sharesAmount', 'shares']))}</td>
                            <td className="py-2 pr-3">{formatMoney(getField(row, ['share_price', 'sharePrice', 'price']))}</td>
                            <td className="py-2">{formatMoney(getField(row, ['offering_amount', 'offeringAmount', 'amount']))}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <NoDataBadge endpointData={data.offerings} />
            )}
          </div>
        ) : null}

        {activeTab === 'history' ? (
          <div className="space-y-3">
            {hasData(data.historicalFloat) ? (
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-white/10 text-zinc-400">
                      <th className="py-2 pr-3 text-left">Date</th>
                      <th className="py-2 pr-3 text-left">Outstanding</th>
                      <th className="py-2 pr-3 text-left">Float</th>
                      <th className="py-2 text-left">Tradable Float</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.historicalFloat.results.map((item, index) => {
                      const row = toRecord(item);
                      return (
                        <tr key={`historical-${index}`} className="border-b border-white/5 text-zinc-300">
                          <td className="py-2 pr-3">{formatDate(getField(row, ['reportedDate', 'reported_date', 'date']))}</td>
                          <td className="py-2 pr-3">{formatNumber(getField(row, ['outstandingShares', 'outstanding_shares', 'outstanding']))}</td>
                          <td className="py-2 pr-3">{formatNumber(getField(row, ['float']))}</td>
                          <td className="py-2">{formatNumber(getField(row, ['tradableFloat', 'tradable_float']))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <NoDataBadge endpointData={data.historicalFloat} />
            )}

            {hasData(data.reverseSplits) ? (
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-white/10 text-zinc-400">
                      <th className="py-2 pr-3 text-left">Date</th>
                      <th className="py-2 text-left">Ratio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.reverseSplits.results.map((item, index) => {
                      const row = toRecord(item);
                      return (
                        <tr key={`split-${index}`} className="border-b border-white/5 text-zinc-300">
                          <td className="py-2 pr-3">{formatDate(getField(row, ['executionDate', 'execution_date', 'date']))}</td>
                          <td className="py-2">
                            {toStringValue(getField(row, ['ratio'])) !== 'N/A'
                              ? toStringValue(getField(row, ['ratio']))
                              : `${toStringValue(getField(row, ['splitFrom', 'split_from']))}:${toStringValue(getField(row, ['splitTo', 'split_to']))}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <NoDataBadge endpointData={data.reverseSplits} />
            )}

            {hasData(data.agreements) ? (
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-white/10 text-zinc-400">
                      <th className="py-2 pr-3 text-left">Type</th>
                      <th className="py-2 pr-3 text-left">Investor</th>
                      <th className="py-2 pr-3 text-left">Date</th>
                      <th className="py-2 text-left">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.agreements.results.map((item, index) => {
                      const row = toRecord(item);
                      return (
                        <tr key={`agreement-${index}`} className="border-b border-white/5 text-zinc-300">
                          <td className="py-2 pr-3">{toStringValue(getField(row, ['agreementType', 'agreement_type', 'type']))}</td>
                          <td className="py-2 pr-3">{toStringValue(getField(row, ['investorNames', 'investor_names', 'investor']))}</td>
                          <td className="py-2 pr-3">{formatDate(getField(row, ['filedAt', 'filed_at', 'date']))}</td>
                          <td className="py-2">{toStringValue(getField(row, ['details', 'summary']))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <NoDataBadge endpointData={data.agreements} />
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}

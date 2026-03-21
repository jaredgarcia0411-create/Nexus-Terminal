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
  | 'cash'
  | 'news-filings'
  | 'offerings'
  | 'risk'
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
    <span className="inline-flex rounded-md border border-zinc-700 bg-zinc-800/60 px-2 py-1 text-xs text-zinc-400">
      No data{endpointData.error ? ` (${endpointData.error})` : ''}
    </span>
  );
}

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'offering-ability', label: 'Offering Ability' },
  { key: 'dilution', label: 'Dilution' },
  { key: 'cash', label: 'Cash' },
  { key: 'news-filings', label: 'News & Filings' },
  { key: 'offerings', label: 'Offerings' },
  { key: 'risk', label: 'Risk' },
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
    };
  }, [rawData]);

  const screenerItem = toRecord(data.screener.results[0]);
  const dilutionItem = toRecord(data.dilutionRating.results[0]);
  const dilutionDataItem = toRecord(data.dilutionData.results[0]);
  const complianceItem = toRecord(data.nasdaqCompliance.results[0]);
  const pumpItem = toRecord(data.pumpAndDump.results[0]);

  return (
    <section className="flex flex-col">
      <div className="border-b border-white/10 px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`rounded px-2.5 py-1 text-xs transition-colors ${
                activeTab === tab.key ? 'bg-emerald-500 text-black' : 'text-zinc-400 hover:bg-white/10 hover:text-zinc-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-3">
        {activeTab === 'overview' ? (
          hasData(data.screener) ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5 text-xs">
              <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-zinc-500">Ticker</p><p className="text-zinc-200">{ticker}</p></div>
              <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-zinc-500">Price</p><p className="text-zinc-200">{formatMoney(getField(screenerItem, ['price']))}</p></div>
              <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-zinc-500">Market Cap</p><p className="text-zinc-200">{formatMoney(getField(screenerItem, ['marketCap', 'market_cap']))}</p></div>
              <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-zinc-500">Float</p><p className="text-zinc-200">{formatNumber(getField(screenerItem, ['float', 'floatShares', 'float_shares']))}</p></div>
              <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-zinc-500">OS</p><p className="text-zinc-200">{formatNumber(getField(screenerItem, ['outstanding', 'outstandingShares', 'sharesOutstanding']))}</p></div>
              <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-zinc-500">Short Interest</p><p className="text-zinc-200">{formatNumber(getField(screenerItem, ['shortInterest', 'short_interest']))}</p></div>
              <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-zinc-500">Fee Rate</p><p className="text-zinc-200">{toStringValue(getField(screenerItem, ['feeRate', 'fee_rate']))}</p></div>
              <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-zinc-500">Country</p><p className="text-zinc-200">{toStringValue(getField(screenerItem, ['country']))}</p></div>
              <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-zinc-500">Industry</p><p className="text-zinc-200">{toStringValue(getField(screenerItem, ['industry']))}</p></div>
              <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-zinc-500">Sector</p><p className="text-zinc-200">{toStringValue(getField(screenerItem, ['sector']))}</p></div>
              <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-zinc-500">Volume</p><p className="text-zinc-200">{formatNumber(getField(screenerItem, ['today_volume', 'volume', 'totalVolume']))}</p></div>
            </div>
          ) : (
            <NoDataBadge endpointData={data.screener} />
          )
        ) : null}

        {activeTab === 'offering-ability' ? (
          <div className="space-y-3">
            {hasData(data.registrations) ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-zinc-400">
                      <th className="py-2 pr-3 text-left">Headline</th>
                      <th className="py-2 pr-3 text-left">ATM</th>
                      <th className="py-2 pr-3 text-left">Shelf</th>
                      <th className="py-2 text-left">Filed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.registrations.results.map((item, index) => {
                      const row = toRecord(item);
                      return (
                        <tr key={`registration-${index}`} className="border-b border-white/5 text-zinc-300">
                          <td className="py-2 pr-3">{toStringValue(getField(row, ['headline', 'title']))}</td>
                          <td className="py-2 pr-3">{toStringValue(getField(row, ['isAtm', 'atm']))}</td>
                          <td className="py-2 pr-3">{toStringValue(getField(row, ['overBabyShelf', 'shelfStatus', 'effectiveStatus']))}</td>
                          <td className="py-2">{formatDate(getField(row, ['filedAt', 'date']))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <NoDataBadge endpointData={data.registrations} />
            )}
            <div className="rounded border border-white/10 bg-white/5 p-3 text-xs text-zinc-300">
              <p className="mb-1 text-zinc-400">Management Commentary</p>
              <p>{toStringValue(getField(dilutionItem, ['mgmt_commentary', 'managementCommentary', 'commentary']))}</p>
            </div>
          </div>
        ) : null}

        {activeTab === 'dilution' ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className={`rounded border px-2 py-1 text-xs ${riskClass(getField(dilutionItem, ['rating', 'dilutionRating']))}`}>
                {toStringValue(getField(dilutionItem, ['rating', 'dilutionRating']))}
              </span>
              <span className="text-xs text-zinc-400">Dilution Rating</span>
            </div>
            {hasData(data.dilutionData) ? (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-xs">
                <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-zinc-500">Warrants</p><p className="text-zinc-200">{toStringValue(getField(dilutionDataItem, ['warrantExercise', 'warrantInfo', 'warrant_exercise']))}</p></div>
                <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-zinc-500">Convertibles</p><p className="text-zinc-200">{toStringValue(getField(dilutionDataItem, ['convertibles', 'convertibleNotes']))}</p></div>
                <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-zinc-500">Auth Shares</p><p className="text-zinc-200">{formatNumber(getField(dilutionDataItem, ['authorizedShares', 'authorized_shares']))}</p></div>
                <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-zinc-500">Available</p><p className="text-zinc-200">{formatNumber(getField(dilutionDataItem, ['sharesAvailable', 'availableShares']))}</p></div>
              </div>
            ) : (
              <NoDataBadge endpointData={data.dilutionData} />
            )}
          </div>
        ) : null}

        {activeTab === 'cash' ? (
          hasData(data.dilutionData) ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-xs">
              <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-zinc-500">Estimated Cash</p><p className="text-zinc-200">{formatMoney(getField(dilutionDataItem, ['estimatedCash', 'cash', 'cashOnHand']))}</p></div>
              <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-zinc-500">Burn Rate</p><p className="text-zinc-200">{formatMoney(getField(dilutionDataItem, ['cashBurn', 'burnRate']))}</p></div>
              <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-zinc-500">Months Remaining</p><p className="text-zinc-200">{toStringValue(getField(dilutionDataItem, ['cashRemainingMonths', 'monthsRemaining']))}</p></div>
              <div className="rounded border border-white/10 bg-white/5 p-2"><p className="text-zinc-500">Debt</p><p className="text-zinc-200">{formatMoney(getField(dilutionDataItem, ['totalDebt', 'debt']))}</p></div>
            </div>
          ) : (
            <NoDataBadge endpointData={data.dilutionData} />
          )
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
                    <summary className="cursor-pointer text-xs text-zinc-200">
                      {toStringValue(getField(item.row, ['headline', 'title']))}
                    </summary>
                    <div className="mt-2 space-y-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className={`rounded border px-2 py-0.5 ${sourceClass}`}>{formType}</span>
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
          hasData(data.offerings) ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
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
                  {data.offerings.results.map((item, index) => {
                    const row = toRecord(item);
                    return (
                      <tr key={`offering-${index}`} className="border-b border-white/5 text-zinc-300">
                        <td className="py-2 pr-3">{formatDate(getField(row, ['filedAt', 'date']))}</td>
                        <td className="py-2 pr-3">{toStringValue(getField(row, ['offeringType', 'type', 'formType']))}</td>
                        <td className="py-2 pr-3">{formatNumber(getField(row, ['sharesAmount', 'shares']))}</td>
                        <td className="py-2 pr-3">{formatMoney(getField(row, ['sharePrice', 'price']))}</td>
                        <td className="py-2">{formatMoney(getField(row, ['offeringAmount', 'amount']))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <NoDataBadge endpointData={data.offerings} />
          )
        ) : null}

        {activeTab === 'risk' ? (
          <div className="space-y-3">
            {hasData(data.pumpAndDump) ? (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-xs">
                {([
                  ['Country', getField(pumpItem, ['countryRisk'])],
                  ['Float', getField(pumpItem, ['floatRisk'])],
                  ['Underwriter', getField(pumpItem, ['underwriterRisk'])],
                  ['Scam', getField(pumpItem, ['scamRisk'])],
                ] as Array<[string, unknown]>).map(([label, value]) => (
                  <div key={label} className={`rounded border px-2 py-2 ${riskClass(value)}`}>
                    <p>{label}</p>
                    <p className="capitalize">{toStringValue(value)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <NoDataBadge endpointData={data.pumpAndDump} />
            )}
            {hasData(data.nasdaqCompliance) ? (
              <div className="rounded border border-white/10 bg-white/5 p-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className={`rounded border px-2 py-1 ${riskClass(getField(complianceItem, ['status', 'complianceStatus', 'rating']))}`}>
                    {toStringValue(getField(complianceItem, ['status', 'complianceStatus', 'rating']))}
                  </span>
                </div>
                <p className="mt-2 text-zinc-300">{toStringValue(getField(complianceItem, ['description', 'details', 'reason']))}</p>
              </div>
            ) : (
              <NoDataBadge endpointData={data.nasdaqCompliance} />
            )}
          </div>
        ) : null}

        {activeTab === 'history' ? (
          <div className="space-y-3">
            {hasData(data.historicalFloat) ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
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
                          <td className="py-2 pr-3">{formatDate(getField(row, ['reportedDate', 'date']))}</td>
                          <td className="py-2 pr-3">{formatNumber(getField(row, ['outstandingShares', 'outstanding']))}</td>
                          <td className="py-2 pr-3">{formatNumber(getField(row, ['float']))}</td>
                          <td className="py-2">{formatNumber(getField(row, ['tradableFloat']))}</td>
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
                <table className="min-w-full text-xs">
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
                          <td className="py-2 pr-3">{formatDate(getField(row, ['executionDate', 'date']))}</td>
                          <td className="py-2">
                            {toStringValue(getField(row, ['ratio'])) !== 'N/A'
                              ? toStringValue(getField(row, ['ratio']))
                              : `${toStringValue(getField(row, ['splitFrom']))}:${toStringValue(getField(row, ['splitTo']))}`}
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
                <table className="min-w-full text-xs">
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
                          <td className="py-2 pr-3">{toStringValue(getField(row, ['agreementType', 'type']))}</td>
                          <td className="py-2 pr-3">{toStringValue(getField(row, ['investorNames', 'investor']))}</td>
                          <td className="py-2 pr-3">{formatDate(getField(row, ['filedAt', 'date']))}</td>
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

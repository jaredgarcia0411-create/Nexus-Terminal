'use client';

interface AskEdgarEndpointResponse {
  status: string;
  results: unknown[];
  error?: string;
}

interface AskEdgarRawReportProps {
  ticker: string;
  rawData: Record<string, AskEdgarEndpointResponse>;
  generatedAt: string;
}

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
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function formatNumber(value: unknown) {
  const numeric = toNumberValue(value);
  return numeric === null ? 'N/A' : numeric.toLocaleString();
}

function formatMoney(value: unknown) {
  const numeric = toNumberValue(value);
  if (numeric === null) return 'N/A';
  return `$${numeric.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatDate(value: unknown) {
  if (typeof value !== 'string' || !value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function getField(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record && record[key] !== null && record[key] !== undefined && record[key] !== '') {
      return record[key];
    }
  }
  return null;
}

function riskClass(value: unknown) {
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

function endpointLabel(key: string) {
  return key
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getEndpoint(rawData: Record<string, AskEdgarEndpointResponse>, keys: string[]): AskEdgarEndpointResponse {
  for (const key of keys) {
    if (rawData[key]) return rawData[key];
  }
  return { status: 'error', results: [], error: 'Endpoint not returned' };
}

function hasEndpointData(endpoint: AskEdgarEndpointResponse) {
  return endpoint.status !== 'error' && Array.isArray(endpoint.results) && endpoint.results.length > 0;
}

function NoDataBadge({ endpoint }: { endpoint: AskEdgarEndpointResponse }) {
  return (
    <span className="rounded-md border border-zinc-700 bg-zinc-800/60 px-2 py-1 text-xs text-zinc-400">
      No data{endpoint.error ? ` (${endpoint.error})` : ''}
    </span>
  );
}

function DataSourcesGrid({ rawData }: { rawData: Record<string, AskEdgarEndpointResponse> }) {
  return (
    <section className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
      <h3 className="text-sm font-medium text-zinc-200 mb-2">Data Sources</h3>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(rawData).map(([key, value]) => {
          const hasData = hasEndpointData(value);
          return (
            <div key={key} className="rounded-md border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-xs">
              <p className="text-zinc-200 font-medium">{endpointLabel(key)}</p>
              <p className={hasData ? 'text-emerald-300' : 'text-zinc-400'}>
                {hasData ? `Data (${value.results.length})` : 'No data'}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function AskEdgarRawReport({ ticker, rawData, generatedAt }: AskEdgarRawReportProps) {
  const screener = getEndpoint(rawData, ['screener']);
  const dilutionRating = getEndpoint(rawData, ['dilution-rating', 'dilutionRating']);
  const dilutionData = getEndpoint(rawData, ['dilution-data', 'dilutionData']);
  const offerings = getEndpoint(rawData, ['offerings']);
  const registrations = getEndpoint(rawData, ['registrations']);
  const news = getEndpoint(rawData, ['news']);
  const nasdaqCompliance = getEndpoint(rawData, ['nasdaq-compliance', 'nasdaqCompliance']);
  const pumpAndDump = getEndpoint(rawData, ['pump-and-dump-tracker', 'pumpAndDumpTracker']);
  const agreements = getEndpoint(rawData, ['agreements']);
  const historicalFloat = getEndpoint(rawData, ['historical-float-pro', 'historicalFloatPro']);
  const reverseSplits = getEndpoint(rawData, ['reverse-splits', 'reverseSplits']);
  const filingTitles = getEndpoint(rawData, ['filing-titles', 'filingTitles']);

  const screenerItem = toRecord(screener.results[0]);
  const dilutionItem = toRecord(dilutionRating.results[0]);
  const dilutionDataItem = toRecord(dilutionData.results[0]);
  const complianceItem = toRecord(nasdaqCompliance.results[0]);
  const pumpItem = toRecord(pumpAndDump.results[0]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-100">{ticker}</h2>
        <span className="text-xs text-zinc-500">{new Date(generatedAt).toLocaleString()}</span>
      </div>

      <DataSourcesGrid rawData={rawData} />

      <section className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h3 className="text-sm font-medium text-zinc-200 mb-2">Screener</h3>
        {hasEndpointData(screener) ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-xs">
            <div className="rounded-md border border-zinc-800 bg-zinc-900/70 p-2"><p className="text-zinc-500">Price</p><p className="text-zinc-100">{formatMoney(getField(screenerItem, ['price']))}</p></div>
            <div className="rounded-md border border-zinc-800 bg-zinc-900/70 p-2"><p className="text-zinc-500">Market Cap</p><p className="text-zinc-100">{formatMoney(getField(screenerItem, ['marketCap', 'market_cap']))}</p></div>
            <div className="rounded-md border border-zinc-800 bg-zinc-900/70 p-2"><p className="text-zinc-500">Float</p><p className="text-zinc-100">{formatNumber(getField(screenerItem, ['float', 'floatShares', 'float_shares']))}</p></div>
            <div className="rounded-md border border-zinc-800 bg-zinc-900/70 p-2"><p className="text-zinc-500">Outstanding</p><p className="text-zinc-100">{formatNumber(getField(screenerItem, ['outstandingShares', 'outstanding', 'sharesOutstanding']))}</p></div>
            <div className="rounded-md border border-zinc-800 bg-zinc-900/70 p-2"><p className="text-zinc-500">Country</p><p className="text-zinc-100">{toStringValue(getField(screenerItem, ['country']))}</p></div>
            <div className="rounded-md border border-zinc-800 bg-zinc-900/70 p-2"><p className="text-zinc-500">Industry</p><p className="text-zinc-100">{toStringValue(getField(screenerItem, ['industry']))}</p></div>
            <div className="rounded-md border border-zinc-800 bg-zinc-900/70 p-2"><p className="text-zinc-500">Sector</p><p className="text-zinc-100">{toStringValue(getField(screenerItem, ['sector']))}</p></div>
            <div className="rounded-md border border-zinc-800 bg-zinc-900/70 p-2"><p className="text-zinc-500">Short Interest</p><p className="text-zinc-100">{formatNumber(getField(screenerItem, ['shortInterest', 'short_interest']))}</p></div>
            <div className="rounded-md border border-zinc-800 bg-zinc-900/70 p-2"><p className="text-zinc-500">Fee Rate</p><p className="text-zinc-100">{toStringValue(getField(screenerItem, ['feeRate', 'fee_rate']))}</p></div>
          </div>
        ) : <NoDataBadge endpoint={screener} />}
      </section>

      <section className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-sm font-medium text-zinc-200">Dilution Rating</h3>
          <span className={`rounded-full border px-2 py-0.5 text-xs ${riskClass(getField(dilutionItem, ['rating', 'dilutionRating']))}`}>
            {toStringValue(getField(dilutionItem, ['rating', 'dilutionRating']))}
          </span>
        </div>
        {hasEndpointData(dilutionRating) ? (
          <>
            <p className="text-sm text-zinc-300">{toStringValue(getField(dilutionItem, ['description', 'ratingDescription']))}</p>
            <p className="text-xs text-zinc-400 mt-2">Warrant info: {toStringValue(getField(dilutionItem, ['warrantExercise', 'warrantInfo', 'warrant_exercise']))}</p>
          </>
        ) : <NoDataBadge endpoint={dilutionRating} />}
      </section>

      <section className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h3 className="text-sm font-medium text-zinc-200 mb-2">Cash / Financials</h3>
        {(hasEndpointData(screener) || hasEndpointData(dilutionData)) ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-xs">
            <div className="rounded-md border border-zinc-800 bg-zinc-900/70 p-2"><p className="text-zinc-500">Estimated Cash</p><p className="text-zinc-100">{formatMoney(getField(dilutionDataItem, ['estimatedCash', 'cash', 'cashOnHand']))}</p></div>
            <div className="rounded-md border border-zinc-800 bg-zinc-900/70 p-2"><p className="text-zinc-500">Burn Rate</p><p className="text-zinc-100">{formatMoney(getField(dilutionDataItem, ['cashBurn', 'burnRate']))}</p></div>
            <div className="rounded-md border border-zinc-800 bg-zinc-900/70 p-2"><p className="text-zinc-500">Months Remaining</p><p className="text-zinc-100">{toStringValue(getField(dilutionDataItem, ['cashRemainingMonths', 'monthsRemaining']))}</p></div>
            <div className="rounded-md border border-zinc-800 bg-zinc-900/70 p-2"><p className="text-zinc-500">Total Debt</p><p className="text-zinc-100">{formatMoney(getField(dilutionDataItem, ['totalDebt', 'debt']))}</p></div>
          </div>
        ) : <NoDataBadge endpoint={dilutionData} />}
      </section>

      <section className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h3 className="text-sm font-medium text-zinc-200 mb-2">News</h3>
        {hasEndpointData(news) ? (
          <div className="space-y-2">
            {news.results.map((item, index) => {
              const row = toRecord(item);
              const body = toStringValue(getField(row, ['body', 'summary', 'details']));
              return (
                <details key={`news-${index}`} className="rounded-md border border-zinc-800 bg-zinc-900/70 p-3">
                  <summary className="cursor-pointer text-sm text-zinc-200">{toStringValue(getField(row, ['title', 'headline']))}</summary>
                  <p className="mt-2 text-xs text-zinc-500">{formatDate(getField(row, ['filedAt', 'date']))} - {toStringValue(getField(row, ['formType', 'form']))}</p>
                  <p className="mt-2 text-sm text-zinc-300">{body.length > 300 ? `${body.slice(0, 300)}...` : body}</p>
                </details>
              );
            })}
          </div>
        ) : <NoDataBadge endpoint={news} />}
      </section>

      <section className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h3 className="text-sm font-medium text-zinc-200 mb-2">Offerings</h3>
        {hasEndpointData(offerings) ? (
          <div className="overflow-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400">
                  <th className="py-2 pr-3 text-left">Date</th>
                  <th className="py-2 pr-3 text-left">Type</th>
                  <th className="py-2 pr-3 text-left">Shares</th>
                  <th className="py-2 pr-3 text-left">Price</th>
                  <th className="py-2 text-left">Amount</th>
                </tr>
              </thead>
              <tbody>
                {offerings.results.map((item, index) => {
                  const row = toRecord(item);
                  return (
                    <tr key={`offering-${index}`} className="border-b border-zinc-900 text-zinc-300">
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
        ) : <NoDataBadge endpoint={offerings} />}
      </section>

      <section className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h3 className="text-sm font-medium text-zinc-200 mb-2">Registrations</h3>
        {hasEndpointData(registrations) ? (
          <div className="overflow-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400">
                  <th className="py-2 pr-3 text-left">Headline</th>
                  <th className="py-2 pr-3 text-left">ATM</th>
                  <th className="py-2 pr-3 text-left">Shelf</th>
                  <th className="py-2 text-left">Filed</th>
                </tr>
              </thead>
              <tbody>
                {registrations.results.map((item, index) => {
                  const row = toRecord(item);
                  return (
                    <tr key={`registration-${index}`} className="border-b border-zinc-900 text-zinc-300">
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
        ) : <NoDataBadge endpoint={registrations} />}
      </section>

      <section className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-sm font-medium text-zinc-200">Nasdaq Compliance</h3>
          <span className={`rounded-full border px-2 py-0.5 text-xs ${riskClass(getField(complianceItem, ['status', 'complianceStatus', 'rating']))}`}>
            {toStringValue(getField(complianceItem, ['status', 'complianceStatus', 'rating']))}
          </span>
        </div>
        {hasEndpointData(nasdaqCompliance) ? (
          <p className="text-sm text-zinc-300">{toStringValue(getField(complianceItem, ['description', 'details', 'reason']))}</p>
        ) : <NoDataBadge endpoint={nasdaqCompliance} />}
      </section>

      <section className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h3 className="text-sm font-medium text-zinc-200 mb-2">Scam / Pump and Dump Signals</h3>
        {hasEndpointData(pumpAndDump) ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-xs">
            {([
              ['Country', getField(pumpItem, ['countryRisk'])],
              ['Float', getField(pumpItem, ['floatRisk'])],
              ['Underwriter', getField(pumpItem, ['underwriterRisk'])],
              ['Scam', getField(pumpItem, ['scamRisk'])],
            ] as Array<[string, unknown]>).map(([label, value]) => (
              <div key={String(label)} className={`rounded-md border px-3 py-2 ${riskClass(value)}`}>
                <p>{label}</p>
                <p className="capitalize">{toStringValue(value)}</p>
              </div>
            ))}
          </div>
        ) : <NoDataBadge endpoint={pumpAndDump} />}
      </section>

      <section className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h3 className="text-sm font-medium text-zinc-200 mb-2">Agreements</h3>
        {hasEndpointData(agreements) ? (
          <div className="overflow-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400">
                  <th className="py-2 pr-3 text-left">Type</th>
                  <th className="py-2 pr-3 text-left">Investor</th>
                  <th className="py-2 pr-3 text-left">Date</th>
                  <th className="py-2 text-left">Details</th>
                </tr>
              </thead>
              <tbody>
                {agreements.results.map((item, index) => {
                  const row = toRecord(item);
                  return (
                    <tr key={`agreement-${index}`} className="border-b border-zinc-900 text-zinc-300">
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
        ) : <NoDataBadge endpoint={agreements} />}
      </section>

      <section className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h3 className="text-sm font-medium text-zinc-200 mb-2">Historical Float</h3>
        {hasEndpointData(historicalFloat) ? (
          <div className="overflow-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400">
                  <th className="py-2 pr-3 text-left">Date</th>
                  <th className="py-2 pr-3 text-left">Outstanding</th>
                  <th className="py-2 pr-3 text-left">Float</th>
                  <th className="py-2 text-left">Tradable Float</th>
                </tr>
              </thead>
              <tbody>
                {historicalFloat.results.map((item, index) => {
                  const row = toRecord(item);
                  return (
                    <tr key={`historical-${index}`} className="border-b border-zinc-900 text-zinc-300">
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
        ) : <NoDataBadge endpoint={historicalFloat} />}
      </section>

      <section className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h3 className="text-sm font-medium text-zinc-200 mb-2">Reverse Splits</h3>
        {hasEndpointData(reverseSplits) ? (
          <div className="overflow-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400">
                  <th className="py-2 pr-3 text-left">Date</th>
                  <th className="py-2 text-left">Ratio</th>
                </tr>
              </thead>
              <tbody>
                {reverseSplits.results.map((item, index) => {
                  const row = toRecord(item);
                  return (
                    <tr key={`split-${index}`} className="border-b border-zinc-900 text-zinc-300">
                      <td className="py-2 pr-3">{formatDate(getField(row, ['executionDate', 'date']))}</td>
                      <td className="py-2">{toStringValue(getField(row, ['ratio'])) !== 'N/A'
                        ? toStringValue(getField(row, ['ratio']))
                        : `${toStringValue(getField(row, ['splitFrom']))}:${toStringValue(getField(row, ['splitTo']))}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <NoDataBadge endpoint={reverseSplits} />}
      </section>

      <section className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
        <h3 className="text-sm font-medium text-zinc-200 mb-2">Filing Titles</h3>
        {hasEndpointData(filingTitles) ? (
          <div className="space-y-2">
            {filingTitles.results.map((item, index) => {
              const row = toRecord(item);
              return (
                <details key={`filing-${index}`} className="rounded-md border border-zinc-800 bg-zinc-900/70 p-3">
                  <summary className="cursor-pointer text-sm text-zinc-200">{toStringValue(getField(row, ['headline', 'title']))}</summary>
                  <p className="mt-2 text-xs text-zinc-500">{toStringValue(getField(row, ['formType', 'form']))} - {formatDate(getField(row, ['filedAt', 'date']))}</p>
                </details>
              );
            })}
          </div>
        ) : <NoDataBadge endpoint={filingTitles} />}
      </section>
    </div>
  );
}

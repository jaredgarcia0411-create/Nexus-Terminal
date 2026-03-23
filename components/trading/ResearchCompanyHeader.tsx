'use client';

interface AskEdgarEndpointResponse {
  status: string;
  results: unknown[];
  error?: string;
}

interface Props {
  ticker: string;
  rawData: Record<string, AskEdgarEndpointResponse>;
  companyName: string | null;
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function getField(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record && record[key] !== null && record[key] !== undefined && record[key] !== '') {
      return record[key];
    }
  }
  return null;
}

function formatCompact(value: unknown): string {
  const num = typeof value === 'number' ? value : typeof value === 'string' ? parseFloat(value) : NaN;
  if (!Number.isFinite(num)) return 'N/A';
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toFixed(2);
}


function firstResult(rawData: Record<string, AskEdgarEndpointResponse>, key: string) {
  return toRecord(rawData[key]?.results?.[0]);
}

function statRow(label: string, value: string) {
  return (
    <div className="flex justify-between gap-2">
      <span className="shrink-0 text-zinc-500">{label}</span>
      <span className="text-right text-zinc-200">{value}</span>
    </div>
  );
}

export default function ResearchCompanyHeader({ ticker, rawData, companyName }: Props) {
  const screener = firstResult(rawData, 'screener');

  const marketCap = getField(screener, ['marketCap', 'market_cap', 'market_cap_final']);
  const outstanding = getField(screener, ['outstanding', 'outstandingShares', 'outstanding_shares']);
  const float = getField(screener, ['float', 'floatShares', 'tradable_float']);
  const exchange = getField(screener, ['exchange']);
  const ipoDate = getField(screener, ['ipodate', 'ipo_date', 'ipoDate']);
  const industry = getField(screener, ['industry']);
  const country = getField(screener, ['country']);

  return (
    <div className="flex h-full flex-col gap-3 border-r border-white/10 bg-[#0f0f11] px-4 py-3">
      {/* Ticker + Company Name */}
      <div>
        <div className="flex items-center gap-2">
          <span className="text-base font-bold text-zinc-100">{ticker}</span>
          {country ? <span className="text-[11px] text-zinc-500">{String(country)}</span> : null}
        </div>
        {companyName ? (
          <p className="mt-0.5 text-base font-bold leading-snug text-zinc-200">{companyName}</p>
        ) : null}
      </div>

      {/* Company Stats */}
      <div className="flex flex-col gap-1 text-sm">
        {statRow('MCap', `$${formatCompact(marketCap)}`)}
        {statRow('OS', formatCompact(outstanding))}
        {statRow('Float', formatCompact(float))}
        {exchange ? statRow('Exchange', String(exchange)) : null}
        {ipoDate ? statRow('IPO', String(ipoDate)) : null}
        {industry ? statRow('Industry', String(industry)) : null}
      </div>

    </div>
  );
}

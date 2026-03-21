'use client';

interface AskEdgarEndpointResponse {
  status: string;
  results: unknown[];
  error?: string;
}

interface Props {
  ticker: string;
  rawData: Record<string, AskEdgarEndpointResponse>;
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

function riskBadge(label: string, value: unknown) {
  const normalized = String(value ?? '').toLowerCase();
  let colorClass = 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300';
  if (normalized.includes('low') || normalized.includes('compliant')) {
    colorClass = 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  } else if (normalized.includes('medium') || normalized.includes('moderate')) {
    colorClass = 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  } else if (normalized.includes('high') || normalized.includes('non-compliant')) {
    colorClass = 'border-rose-500/30 bg-rose-500/10 text-rose-300';
  }
  return (
    <span className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${colorClass}`}>
      {String(value ?? 'N/A')} {label}
    </span>
  );
}

function firstResult(rawData: Record<string, AskEdgarEndpointResponse>, key: string) {
  return toRecord(rawData[key]?.results?.[0]);
}

export default function ResearchCompanyHeader({ ticker, rawData }: Props) {
  const screener = firstResult(rawData, 'screener');
  const dilutionRating = firstResult(rawData, 'dilution-rating');

  const companyName = getField(screener, ['companyName', 'company_name', 'name']);
  const marketCap = getField(screener, ['marketCap', 'market_cap', 'market_cap_final']);
  const outstanding = getField(screener, ['outstanding', 'outstandingShares', 'outstanding_shares']);
  const float = getField(screener, ['float', 'floatShares', 'tradable_float']);
  const exchange = getField(screener, ['exchange']);
  const ipoDate = getField(screener, ['ipodate', 'ipo_date', 'ipoDate']);
  const industry = getField(screener, ['industry']);
  const country = getField(screener, ['country']);

  const overallRisk = getField(dilutionRating, ['rating', 'dilutionRating', 'overall_risk']);
  const offeringRisk = getField(dilutionRating, ['offeringAbility', 'offering_ability']);
  const dilutionRisk = getField(dilutionRating, ['dilution', 'dilution_rating']);
  const cashNeed = getField(dilutionRating, ['cashNeed', 'cash_need']);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-white/10 bg-[#0f0f11] px-4 py-2.5">
      <div className="flex items-center gap-2">
        {country ? <span className="text-xs text-zinc-500">{String(country)}</span> : null}
        <span className="text-sm font-semibold text-zinc-100">{ticker}</span>
        {companyName ? <span className="text-xs text-zinc-400">{String(companyName)}</span> : null}
      </div>

      <div className="flex items-center gap-3 text-xs text-zinc-300">
        <span>${formatCompact(marketCap)} <span className="text-zinc-500">MCap</span></span>
        <span>{formatCompact(outstanding)} <span className="text-zinc-500">OS</span></span>
        <span>{formatCompact(float)} <span className="text-zinc-500">Float</span></span>
      </div>

      <div className="flex items-center gap-1.5">
        {riskBadge('Overall', overallRisk)}
        {riskBadge('Offering', offeringRisk)}
        {riskBadge('Dilution', dilutionRisk)}
        {riskBadge('Cash', cashNeed)}
      </div>

      <div className="flex items-center gap-3 text-xs text-zinc-500">
        {exchange ? <span>{String(exchange)}</span> : null}
        {ipoDate ? <span>{String(ipoDate)}</span> : null}
        {industry ? <span>{String(industry)}</span> : null}
      </div>
    </div>
  );
}

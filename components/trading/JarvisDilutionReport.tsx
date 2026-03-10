'use client';

import type { DilutionResearchReport, RiskLevel, RiskRating } from '@/lib/jarvis/types';

interface JarvisDilutionReportProps {
  report: DilutionResearchReport;
}

function formatNumber(value: number | null) {
  if (value === null || !Number.isFinite(value)) return 'N/A';
  return value.toLocaleString();
}

function formatMoney(value: number | null) {
  if (value === null || !Number.isFinite(value)) return 'N/A';
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function gainClass(value: number | null) {
  if (value === null) return 'text-zinc-300';
  if (value > 0) return 'text-emerald-300';
  if (value < 0) return 'text-rose-300';
  return 'text-zinc-300';
}

function riskClass(risk: RiskRating | RiskLevel | undefined) {
  const normalized = String(risk ?? '').toLowerCase();
  if (normalized === 'low') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (normalized === 'medium') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  if (normalized === 'high') return 'border-rose-500/30 bg-rose-500/10 text-rose-300';
  return 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300';
}

function NoData() {
  return <p className="text-sm text-zinc-400">No data available</p>;
}

export default function JarvisDilutionReport({ report }: JarvisDilutionReportProps) {
  return (
    <div className="space-y-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold text-zinc-100">{report.ticker} Dilution Research</h3>
          <span className="text-xs text-zinc-400">Generated {new Date(report.generatedAt).toLocaleString()}</span>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-sm text-zinc-200">
          <p>Price: {formatMoney(report.header.price)}</p>
          <p>Market Cap: {formatMoney(report.header.marketCap)}</p>
          <p>Float / OS: {formatNumber(report.header.float)} / {formatNumber(report.header.outstanding)}</p>
          <p>Country: {report.header.country || 'N/A'}</p>
          <p>Industry: {report.header.industry || 'N/A'}</p>
          <p>Sector: {report.header.sector || 'N/A'}</p>
          <p className={gainClass(report.header.gain1d)}>1D: {report.header.gain1d ?? 'N/A'}</p>
          <p className={gainClass(report.header.gain7d)}>7D: {report.header.gain7d ?? 'N/A'}</p>
          <p className={gainClass(report.header.gain30d)}>30D: {report.header.gain30d ?? 'N/A'}</p>
          <p>Short Float: {report.header.shortFloat ?? 'N/A'}</p>
          <p>Short Interest: {formatNumber(report.header.shortInterest)}</p>
          <p>Fee Rate: {report.header.feeRate ?? 'N/A'}</p>
          <p>Insider %: {report.header.insiderPercent ?? 'N/A'}</p>
          <p>Affiliate %: {report.header.affiliatePercent ?? 'N/A'}</p>
          <p>Institutions %: {report.header.institutionsPercent ?? 'N/A'}</p>
        </div>
      </div>

      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h4 className="text-sm font-semibold text-zinc-100">Data Sources</h4>
        {report.dataSources.length > 0 ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {report.dataSources.map((source) => (
              <div key={source.endpoint} className="rounded-lg border border-white/10 bg-white/5 p-2 text-xs text-zinc-300">
                <p className="font-medium text-zinc-100">{source.label}</p>
                <p>{source.hasData ? '✓ Data returned' : '✕ No data'}</p>
              </div>
            ))}
          </div>
        ) : <NoData />}
      </section>

      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h4 className="text-sm font-semibold text-zinc-100">News / Why It&apos;s Running</h4>
        {report.news.length > 0 ? report.news.map((item, index) => (
          <details key={`${item.filedAt}-${index}`} className="mt-2 rounded-lg border border-white/10 bg-white/5 p-2">
            <summary className="cursor-pointer text-sm text-zinc-100">{item.title || item.summary || item.formType || 'Untitled item'}</summary>
            <p className="mt-2 text-xs text-zinc-400">{item.filedAt || 'N/A'} - {item.formType || 'N/A'}</p>
            <p className="mt-1 text-sm text-zinc-200">{item.summary || item.body || 'No data available'}</p>
            {item.tags.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {item.tags.map((tag) => <span key={`${item.filedAt}-${tag}`} className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-zinc-300">{tag}</span>)}
              </div>
            ) : null}
          </details>
        )) : <NoData />}
      </section>

      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h4 className="text-sm font-semibold text-zinc-100">Other Catalysts</h4>
        {report.catalysts.length > 0 ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {report.catalysts.map((item, index) => (
              <div key={`${item.type}-${item.date}-${index}`} className="rounded-lg border border-white/10 bg-white/5 p-2 text-sm text-zinc-200">
                <p className="font-medium">{item.type || 'Catalyst'}</p>
                <p className="text-xs text-zinc-400">{item.date || 'N/A'} - {item.source}</p>
                <p className="mt-1">{item.description || 'No data available'}</p>
              </div>
            ))}
          </div>
        ) : <NoData />}
      </section>

      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-zinc-100">Dilution</h4>
          <span className={`rounded-full border px-2 py-0.5 text-xs ${riskClass(report.dilution.rating)}`}>{report.dilution.rating || 'N/A'}</span>
        </div>
        <p className="mt-1 text-sm text-zinc-300">{report.dilution.description || 'No data available'}</p>
        <p className="mt-2 text-xs text-zinc-400">Warrant exercise: {report.dilution.warrantExercise || 'N/A'} - {report.dilution.warrantExerciseDesc || 'No data available'}</p>
        <p className="mt-2 text-xs uppercase tracking-wider text-zinc-500">Warrants</p>
        {report.dilution.warrants.length > 0 ? (
          <div className="mt-1 overflow-auto"><table className="min-w-full text-xs"><tbody>{report.dilution.warrants.map((item, index) => <tr key={`${item.filedAt}-${index}`}><td className="pr-3 py-1">{item.details || 'N/A'}</td><td className="pr-3 py-1">{formatNumber(item.amount)}</td><td className="py-1">{formatMoney(item.exercisePrice)}</td></tr>)}</tbody></table></div>
        ) : <NoData />}
        <p className="mt-3 text-xs uppercase tracking-wider text-zinc-500">Convertibles</p>
        {report.dilution.convertibles.length > 0 ? (
          <div className="mt-1 overflow-auto"><table className="min-w-full text-xs"><tbody>{report.dilution.convertibles.map((item, index) => <tr key={`${item.filedAt}-${index}`}><td className="pr-3 py-1">{item.details || 'N/A'}</td><td className="pr-3 py-1">{formatMoney(item.offeringAmount)}</td><td className="py-1">{formatMoney(item.conversionPrice)}</td></tr>)}</tbody></table></div>
        ) : <NoData />}
      </section>

      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-zinc-100">Offering Frequency</h4>
          <span className={`rounded-full border px-2 py-0.5 text-xs ${riskClass(report.offeringFrequency.rating)}`}>{report.offeringFrequency.rating || 'N/A'}</span>
        </div>
        <p className="mt-1 text-sm text-zinc-300">{report.offeringFrequency.description || 'No data available'}</p>
        {report.offeringFrequency.offerings.length > 0 ? (
          <ul className="mt-2 space-y-1 text-sm text-zinc-200">{report.offeringFrequency.offerings.map((item, index) => <li key={`${item.filedAt}-${index}`}>{item.filedAt || 'N/A'} - {item.headline || 'Untitled offering'}</li>)}</ul>
        ) : <NoData />}
      </section>

      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-zinc-100">Offering Ability</h4>
          <span className={`rounded-full border px-2 py-0.5 text-xs ${riskClass(report.offeringAbility.rating)}`}>{report.offeringAbility.rating || 'N/A'}</span>
        </div>
        <p className="mt-1 text-sm text-zinc-300">{report.offeringAbility.description || 'No data available'}</p>
        {report.offeringAbility.registrations.length > 0 ? (
          <div className="mt-2 overflow-auto"><table className="min-w-full text-xs"><tbody>{report.offeringAbility.registrations.map((item, index) => <tr key={`${item.filedAt}-${index}`}><td className="pr-3 py-1">{item.headline || 'Registration'}</td><td className="pr-3 py-1">{item.isAtm ? 'ATM' : 'Non-ATM'}</td><td className="py-1">{item.overBabyShelf ? 'Over Baby Shelf' : 'Within Baby Shelf'}</td></tr>)}</tbody></table></div>
        ) : <NoData />}
      </section>

      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-zinc-100">Cash Need</h4>
          <span className={`rounded-full border px-2 py-0.5 text-xs ${riskClass(report.cashNeed.rating)}`}>{report.cashNeed.rating || 'N/A'}</span>
        </div>
        <p className="mt-1 text-sm text-zinc-300">{report.cashNeed.description || 'No data available'}</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm text-zinc-200">
          <p>Cash: {formatMoney(report.cashNeed.estimatedCash)}</p>
          <p>Burn: {formatMoney(report.cashNeed.cashBurn)}</p>
          <p>Months: {report.cashNeed.cashRemainingMonths ?? 'N/A'}</p>
          <p>Debt: {formatMoney(report.cashNeed.totalDebt)}</p>
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h4 className="text-sm font-semibold text-zinc-100">Management Commentary</h4>
        {report.managementCommentary ? <blockquote className="mt-2 border-l border-white/20 pl-3 text-sm text-zinc-300">{report.managementCommentary}</blockquote> : <NoData />}
      </section>

      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-zinc-100">Overall Offering Risk</h4>
          <span className={`rounded-full border px-2 py-0.5 text-xs ${riskClass(report.overallOfferingRisk.rating)}`}>{report.overallOfferingRisk.rating || 'N/A'}</span>
        </div>
        <p className="mt-1 text-sm text-zinc-300">RegSHO: {report.overallOfferingRisk.regsho ? 'Yes' : 'No'}</p>
        <p className="text-sm text-zinc-300">Nasdaq compliance: {report.overallOfferingRisk.nasdaqCompliance || 'N/A'} - {report.overallOfferingRisk.nasdaqComplianceDesc || 'No data available'}</p>
      </section>

      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h4 className="text-sm font-semibold text-zinc-100">Scam Risk</h4>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Country', report.scamRisk.countryRisk],
            ['Float', report.scamRisk.floatRisk],
            ['Underwriter', report.scamRisk.underwriterRisk],
            ['Scam', report.scamRisk.scamRisk],
          ].map(([label, value]) => (
            <div key={label} className={`rounded-lg border px-2 py-1 text-xs ${riskClass(value as RiskLevel)}`}>
              <p className="text-zinc-200">{label}</p>
              <p className="capitalize">{String(value || 'N/A')}</p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-sm text-zinc-300">{report.scamRisk.scamDescription || 'No data available'}</p>
      </section>

      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h4 className="text-sm font-semibold text-zinc-100">Agreements &amp; Lock-ups</h4>
        {report.agreements.length > 0 ? report.agreements.map((item, index) => (
          <div key={`${item.filedAt}-${index}`} className="mt-2 rounded-lg border border-white/10 bg-white/5 p-2 text-sm text-zinc-200">
            <p className="font-medium">{item.agreementType || 'Agreement'}</p>
            <p className="text-xs text-zinc-400">{item.investorNames || 'N/A'} - {item.filedAt || 'N/A'}</p>
            <p className="mt-1">{item.details || 'No data available'}</p>
          </div>
        )) : <NoData />}
      </section>

      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h4 className="text-sm font-semibold text-zinc-100">Historical Float</h4>
        {report.historicalFloat.length > 0 ? (
          <div className="mt-2 overflow-auto"><table className="min-w-full text-xs"><tbody>{report.historicalFloat.map((item, index) => <tr key={`${item.reportedDate}-${index}`}><td className="pr-3 py-1">{item.reportedDate || 'N/A'}</td><td className="pr-3 py-1">{formatNumber(item.outstandingShares)}</td><td className="pr-3 py-1">{formatNumber(item.float)}</td><td className="py-1">{formatNumber(item.tradableFloat)}</td></tr>)}</tbody></table></div>
        ) : <NoData />}
      </section>

      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h4 className="text-sm font-semibold text-zinc-100">Reverse Splits</h4>
        {report.reverseSplits.length > 0 ? (
          <div className="mt-2 overflow-auto"><table className="min-w-full text-xs"><tbody>{report.reverseSplits.map((item, index) => <tr key={`${item.executionDate}-${index}`}><td className="pr-3 py-1">{item.executionDate || 'N/A'}</td><td className="py-1">{item.splitFrom}:{item.splitTo}</td></tr>)}</tbody></table></div>
        ) : <NoData />}
      </section>
    </div>
  );
}

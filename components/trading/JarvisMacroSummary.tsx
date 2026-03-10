import React from 'react';
import type { JarvisMacroSummaryOutput, MacroSummaryRegion } from '@/lib/jarvis/types';

interface JarvisMacroSummaryProps {
  macroSummary: JarvisMacroSummaryOutput;
}

const REGION_LABELS: Record<MacroSummaryRegion, string> = {
  us: 'United States',
  eu: 'Europe',
  asia: 'Asia-Pacific',
  global: 'Global',
};

const SENTIMENT_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  bullish: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-300' },
  bearish: { bg: 'bg-rose-500/10', border: 'border-rose-500/30', text: 'text-rose-300' },
  neutral: { bg: 'bg-zinc-500/10', border: 'border-zinc-500/30', text: 'text-zinc-300' },
  mixed: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-300' },
};

function sentimentStyle(sentiment: string) {
  return SENTIMENT_STYLES[sentiment] ?? SENTIMENT_STYLES.neutral;
}

export default function JarvisMacroSummary({ macroSummary }: JarvisMacroSummaryProps) {
  const overallStyle = sentimentStyle(macroSummary.overallSentiment);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-400">Macro Summary - {macroSummary.date}</p>
        <span className={`rounded-full border px-3 py-0.5 text-xs capitalize ${overallStyle.bg} ${overallStyle.border} ${overallStyle.text}`}>
          {macroSummary.overallSentiment}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {macroSummary.regions.map((region) => {
          const style = sentimentStyle(region.sentiment);
          return (
            <div
              key={region.region}
              className={`rounded-xl border p-4 ${style.border} bg-black/20`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-zinc-100">{REGION_LABELS[region.region] ?? region.region}</p>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] capitalize ${style.bg} ${style.border} ${style.text}`}>
                  {region.sentiment}
                </span>
              </div>
              <p className="mt-2 text-sm text-zinc-200">{region.headline}</p>
              {region.details.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {region.details.map((detail, i) => (
                    <li key={`macro-detail-${region.region}-${i}`} className="flex gap-2 text-xs text-zinc-400">
                      <span className="text-zinc-500">-</span>
                      <span>{detail}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>

      {macroSummary.keyRisks.length > 0 ? (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
          <p className="text-[11px] uppercase tracking-[0.2em] text-amber-200">Key Macro Risks</p>
          <ul className="mt-2 space-y-1.5 text-sm text-amber-100">
            {macroSummary.keyRisks.map((risk, i) => (
              <li key={`macro-risk-${i}`} className="flex gap-2">
                <span className="text-amber-300">!</span>
                <span>{risk}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

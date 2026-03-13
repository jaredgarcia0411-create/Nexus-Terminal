import React from 'react';
import type {
  JarvisMacroSummaryLegacyOutput,
  JarvisMacroSummaryOutput,
  MacroSummaryRegion,
} from '@/lib/jarvis/types';

interface JarvisMacroSummaryProps {
  macroSummary: JarvisMacroSummaryOutput;
}

const MACRO_LINKS = [
  { label: 'Federal Reserve', href: 'https://www.federalreserve.gov/' },
  { label: 'U.S. Treasury', href: 'https://home.treasury.gov/' },
  { label: 'CBOE', href: 'https://www.cboe.com/' },
  { label: 'Google Finance', href: 'https://www.google.com/finance/' },
  { label: 'CNN Business', href: 'https://www.cnn.com/business' },
];

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

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function isLegacySummary(summary: JarvisMacroSummaryOutput): summary is JarvisMacroSummaryLegacyOutput {
  return 'regions' in summary || 'overallSentiment' in summary || 'keyRisks' in summary;
}

export default function JarvisMacroSummary({ macroSummary }: JarvisMacroSummaryProps) {
  if (isLegacySummary(macroSummary)) {
    const overallStyle = sentimentStyle(macroSummary.overallSentiment);
    const regions = Array.isArray(macroSummary.regions) ? macroSummary.regions : [];
    const keyRisks = toStringArray(macroSummary.keyRisks);

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">Macro Summary - {macroSummary.date}</p>
          <span className={`rounded-full border px-3 py-0.5 text-sm capitalize ${overallStyle.bg} ${overallStyle.border} ${overallStyle.text}`}>
            {macroSummary.overallSentiment}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {regions.map((region) => {
            const style = sentimentStyle(region.sentiment);
            const details = toStringArray(region.details);

            return (
              <div
                key={region.region}
                className={`rounded-xl border p-4 ${style.border} bg-black/20`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-base font-semibold text-zinc-100">{REGION_LABELS[region.region] ?? region.region}</p>
                  <span className={`rounded-full border px-2 py-0.5 text-xs capitalize ${style.bg} ${style.border} ${style.text}`}>
                    {region.sentiment}
                  </span>
                </div>
                <p className="mt-2 text-base text-zinc-200">{region.headline}</p>
                {details.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {details.map((detail, i) => (
                      <li key={`macro-detail-${region.region}-${i}`} className="flex gap-2 text-sm text-zinc-400">
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

        {keyRisks.length > 0 ? (
          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-amber-200">Key Macro Risks</p>
            <ul className="mt-2 space-y-1.5 text-base text-zinc-200">
              {keyRisks.map((risk, i) => (
                <li key={`macro-risk-${i}`} className="flex gap-2">
                  <span className="text-zinc-400">!</span>
                  <span>{risk}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">Reference Links</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {MACRO_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="rounded border border-white/15 bg-white/5 px-2 py-1 text-sm text-zinc-200 transition hover:bg-white/10"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const headline = typeof macroSummary.headline === 'string' && macroSummary.headline.trim().length > 0
    ? macroSummary.headline
    : 'Macro conditions update';
  const keyThemes = toStringArray(macroSummary.key_themes);
  const riskFlags = toStringArray(macroSummary.risk_flags);
  const watchlistNotes = toStringArray(macroSummary.watchlist_notes);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-white/10 bg-black/20 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">Macro Summary</p>
        <p className="mt-2 text-base text-zinc-100">{headline}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-200">Key Themes</p>
          {keyThemes.length > 0 ? (
            <ul className="mt-2 space-y-1.5 text-base text-zinc-200">
              {keyThemes.map((theme, i) => (
                <li key={`macro-theme-${i}`} className="flex gap-2">
                  <span className="text-zinc-400">-</span>
                  <span>{theme}</span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-2 text-base text-zinc-400">No key themes available.</p>}
        </div>

        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <p className="text-xs uppercase tracking-[0.2em] text-sky-200">Watchlist Notes</p>
          {watchlistNotes.length > 0 ? (
            <ul className="mt-2 space-y-1.5 text-base text-zinc-200">
              {watchlistNotes.map((note, i) => (
                <li key={`macro-watch-${i}`} className="flex gap-2">
                  <span className="text-zinc-400">-</span>
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-2 text-base text-zinc-400">No watchlist notes available.</p>}
        </div>
      </div>

      {riskFlags.length > 0 ? (
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <p className="text-xs uppercase tracking-[0.2em] text-amber-200">Key Macro Risks</p>
          <ul className="mt-2 space-y-1.5 text-base text-zinc-200">
            {riskFlags.map((risk, i) => (
              <li key={`macro-risk-${i}`} className="flex gap-2">
                <span className="text-zinc-400">!</span>
                <span>{risk}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-lg border border-white/10 bg-black/20 p-3">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">Reference Links</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {MACRO_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noreferrer"
              className="rounded border border-white/15 bg-white/5 px-2 py-1 text-sm text-zinc-200 transition hover:bg-white/10"
            >
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

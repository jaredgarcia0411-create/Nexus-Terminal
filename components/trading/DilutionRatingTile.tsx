'use client';

import { toStringValue } from '@/lib/askedgar-utils';
import type { ResearchSnapshot } from '@/lib/types';

interface TileProps {
  offeringAbilityRating: string | null;
  offeringFrequencyRating: string | null;
  dilutionRating: string | null;
  cashNeedRating: string | null;
  overallRisk: string | null;
  warrantExerciseRating: string | null;
  nasdaqCompliance: string | null;
}

type RatingLevel = 'low' | 'medium' | 'high' | 'na';

// Decide which traffic-light tier a free-text rating falls into.
// We check "high" before "low" so values like "High Risk" never accidentally hit the "low/positive" branch.
function ratingLevel(value: string | null): RatingLevel {
  if (!value) return 'na';
  const v = value.toLowerCase();
  if (v.includes('non-compliant') || v.includes('high') || v.includes('risk')) return 'high';
  if (v.includes('medium') || v.includes('watch') || v.includes('warning')) return 'medium';
  if (v.includes('low') || v.includes('compliant') || v.includes('positive')) return 'low';
  return 'na';
}

// Three vertical bars with progressive height. Active bars get the level color; inactive bars stay dim grey.
function BarChartIcon({ level, size = 'sm' }: { level: RatingLevel; size?: 'sm' | 'md' }) {
  const dim = 'fill-zinc-700';
  const colorMap: Record<Exclude<RatingLevel, 'na'>, string> = {
    low: 'fill-emerald-500',
    medium: 'fill-amber-500',
    high: 'fill-rose-500',
  };
  const active = level === 'na' ? null : colorMap[level];
  // active bars by tier: low=1, medium=2, high=3, na=0
  const tierCount = level === 'low' ? 1 : level === 'medium' ? 2 : level === 'high' ? 3 : 0;
  const bar1 = tierCount >= 1 && active ? active : dim;
  const bar2 = tierCount >= 2 && active ? active : dim;
  const bar3 = tierCount >= 3 && active ? active : dim;
  const dimensions = size === 'md' ? 'h-3.5 w-3.5' : 'h-3 w-3';
  return (
    <svg className={dimensions} viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="7" width="2" height="4" className={bar1} />
      <rect x="5" y="4" width="2" height="7" className={bar2} />
      <rect x="9" y="1" width="2" height="10" className={bar3} />
    </svg>
  );
}

export default function DilutionRatingTile(props: TileProps) {
  const rows: Array<{ label: string; value: string | null }> = [
    { label: 'Ofr. Ability', value: props.offeringAbilityRating },
    { label: 'Ofr. Freq.', value: props.offeringFrequencyRating },
    { label: 'Dilution', value: props.dilutionRating },
    { label: 'Cash Need', value: props.cashNeedRating },
    { label: 'Overall Ofr. Risk', value: props.overallRisk },
    { label: 'Warrant Exercise', value: props.warrantExerciseRating },
    { label: 'Nasdaq Compliance', value: props.nasdaqCompliance },
  ];

  return (
    <div>
      <h4 className="mb-2 text-base font-semibold text-zinc-200">Dilution Rating</h4>
      <div className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-white">{row.label}</span>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-zinc-200">{toStringValue(row.value)}</span>
              <BarChartIcon level={ratingLevel(row.value)} size="md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Larger Dilution-tab panel: dynamic banner + 6-tile grid ---

// Subtle colored bg per tier. No border per spec ("traffic lights with no border").
function pillClasses(level: RatingLevel): string {
  if (level === 'high') return 'bg-rose-500/15 text-rose-300';
  if (level === 'medium') return 'bg-amber-500/15 text-amber-300';
  if (level === 'low') return 'bg-emerald-500/15 text-emerald-300';
  return 'bg-zinc-700/40 text-zinc-400';
}

function bannerClasses(level: RatingLevel): string {
  if (level === 'high') return 'border-rose-500/30 bg-rose-500/5 text-rose-300';
  if (level === 'medium') return 'border-amber-500/30 bg-amber-500/5 text-amber-300';
  if (level === 'low') return 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300';
  return 'border-zinc-500/30 bg-zinc-500/5 text-zinc-400';
}

function BannerIcon() {
  return (
    <svg
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="12" r="9" strokeWidth={2} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01" />
    </svg>
  );
}

interface PanelProps {
  data: Pick<
    ResearchSnapshot,
    | 'offeringAbilityRating'
    | 'offeringFrequencyRating'
    | 'dilutionRating'
    | 'cashNeedRating'
    | 'overallRisk'
    | 'warrantExerciseRating'
    | 'nasdaqCompliance'
  >;
}

export function DilutionRatingPanel({ data }: PanelProps) {
  const overallLevel = ratingLevel(data.overallRisk);
  const overallText = toStringValue(data.overallRisk);

  // Match the screenshot order: row 1 = Ability/Dilution/Frequency, row 2 = Cash/Warrant/Nasdaq.
  const items: Array<{ label: string; value: string | null }> = [
    { label: 'Offering Ability', value: data.offeringAbilityRating },
    { label: 'Dilution', value: data.dilutionRating },
    { label: 'Offering Frequency', value: data.offeringFrequencyRating },
    { label: 'Cash Need', value: data.cashNeedRating },
    { label: 'Warrant Exercise', value: data.warrantExerciseRating },
    { label: 'Nasdaq Compliance', value: data.nasdaqCompliance },
  ];

  return (
    <div className="space-y-4">
      <div className={`flex items-center gap-2 rounded border px-3 py-2 text-sm font-semibold ${bannerClasses(overallLevel)}`}>
        <BannerIcon />
        <span>Overall offering risk is {overallText}</span>
      </div>

      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const level = ratingLevel(item.value);
          return (
            <div key={item.label} className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-white">{item.label}</span>
              <span className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-sm font-medium ${pillClasses(level)}`}>
                <BarChartIcon level={level} size="md" />
                {toStringValue(item.value)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

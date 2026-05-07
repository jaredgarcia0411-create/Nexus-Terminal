'use client';

import { toStringValue } from '@/lib/askedgar-utils';

interface Props {
  offeringAbilityRating: string | null;
  offeringFrequencyRating: string | null;
  dilutionRating: string | null;
  cashNeedRating: string | null;
  overallRisk: string | null;
  warrantExerciseRating: string | null;
  nasdaqCompliance: string | null;
}

function iconColorClass(value: string | null): string {
  if (!value) return 'text-zinc-500';
  const v = value.toLowerCase();
  if (v.includes('non-compliant') || v.includes('high') || v.includes('risk')) return 'text-rose-500';
  if (v.includes('medium') || v.includes('watch') || v.includes('warning')) return 'text-amber-500';
  if (v.includes('low') || v.includes('compliant') || v.includes('positive')) return 'text-emerald-500';
  return 'text-zinc-500';
}

function BarChartIcon({ colorClass }: { colorClass: string }) {
  return (
    <svg className={`h-3 w-3 ${colorClass}`} fill="currentColor" viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="7" width="2" height="4" />
      <rect x="5" y="4" width="2" height="7" />
      <rect x="9" y="1" width="2" height="10" />
    </svg>
  );
}

export default function DilutionRatingTile(props: Props) {
  const rows = [
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
      <h4 className="mb-2 text-sm font-semibold text-zinc-200">Dilution Rating</h4>
      <div className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-2">
            <span className="text-xs text-zinc-400">{row.label}</span>
            <div className="flex items-center gap-2">
              <BarChartIcon colorClass={iconColorClass(row.value)} />
              <span className="text-xs font-medium text-zinc-200">{toStringValue(row.value)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

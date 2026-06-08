function formatScaled(value: number, units: Array<{ size: number; suffix: string }>, decimalsFor: (scaled: number) => number) {
  if (!Number.isFinite(value)) return '';

  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  for (const unit of units) {
    if (absolute >= unit.size) {
      const scaled = absolute / unit.size;
      return `${sign}${scaled.toFixed(decimalsFor(scaled))}${unit.suffix}`;
    }
  }

  return `${Math.round(value)}`;
}

const COMPACT_UNITS = [
  { size: 1_000_000_000, suffix: 'B' },
  { size: 1_000_000, suffix: 'M' },
  { size: 1_000, suffix: 'K' },
];

export function formatCompactShares(n: number): string {
  return formatScaled(n, COMPACT_UNITS, (scaled) => {
    if (scaled < 10) return 2;
    return 1;
  });
}

export function formatCompactUsd(n: number): string {
  const formatted = formatScaled(n, COMPACT_UNITS, () => 1);
  return formatted ? `$${formatted}` : '';
}

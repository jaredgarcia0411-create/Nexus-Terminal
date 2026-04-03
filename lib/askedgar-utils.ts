// Client-safe utilities for AskEdgar API response handling.
// No server-only imports — safe to use in client components.

export interface AskEdgarEndpointResponse {
  status: string;
  results: unknown[];
  error?: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function toRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function toNumberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[$,%]/g, '').replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// Looks up the first non-null, non-empty value among the given keys in a record.
// AskEdgar uses inconsistent snake_case vs camelCase — this handles both.
export function getField(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record && record[key] !== null && record[key] !== undefined && record[key] !== '') {
      return record[key];
    }
  }
  return null;
}

export function formatNumber(value: unknown): string {
  const numeric = toNumberValue(value);
  return numeric === null ? 'N/A' : numeric.toLocaleString();
}

export function formatMoney(value: unknown): string {
  const numeric = toNumberValue(value);
  if (numeric === null) return 'N/A';
  return `$${numeric.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

// Returns Tailwind CSS classes for a dilution risk rating.
// Low/Compliant/Positive → emerald. Medium/Watch → amber. High/Risk/Non-compliant → rose.
export function riskClass(value: unknown): string {
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

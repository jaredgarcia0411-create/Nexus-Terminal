// Client-safe utilities for AskEdgar API response handling.
// No server-only imports — safe to use in client components.

import type { ResearchSnapshotRegistration, ResearchSnapshotWarrant } from '@/lib/types';

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

// Converts an arbitrary value to a display string. Used in detail grids.
export function toStringValue(value: string | number | boolean | null | undefined): string {
  if (typeof value === 'string') return value || 'N/A';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return 'N/A';
}

// Formats an ISO date string as a locale date. Returns the original string if
// it can't be parsed, so callers always get something displayable.
export function formatDate(value: string | null | undefined): string {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

// Maps a Tailwind color class string to the matching solid dot background class.
// Used to render colored indicator dots next to risk badges.
export function riskDotClass(colorClass: string): string {
  if (colorClass.includes('emerald')) return 'bg-emerald-500';
  if (colorClass.includes('amber')) return 'bg-amber-500';
  if (colorClass.includes('rose')) return 'bg-rose-500';
  return 'bg-zinc-500';
}

// Derives the SEC form type from a registration row. Falls back to headline
// keyword matching when the explicit formType field is absent.
export function detectFormType(row: ResearchSnapshotRegistration): string | null {
  if (row.formType) return row.formType.toUpperCase();
  const headline = row.headline.toUpperCase();
  if (headline.includes('S-1')) return 'S-1';
  if (headline.includes('S-3')) return 'S-3';
  if (headline.includes('F-3')) return 'F-3';
  return null;
}

// Returns a label + color class for the baby shelf status badge on a registration row.
// Returns null when no badge should be shown (S-1 exempt or no baby shelf).
// colorClass is text-only (no border/bg) so the same value can be reused for
// inline labels AND data cells (e.g., the ATM Remaining number).
export function babyShelfBadge(row: ResearchSnapshotRegistration): { label: string; colorClass: string } | null {
  const formType = detectFormType(row);
  const raisable = row.babyShelfRaisableAmount;

  const GREEN = 'text-emerald-400';
  const AMBER = 'text-amber-400';
  const RED = 'text-rose-500';

  if (formType === 'S-1') return { label: 'S-1 Exempt', colorClass: GREEN };
  if (!row.overBabyShelf) return { label: 'No Baby Shelf', colorClass: GREEN };
  if (raisable !== null && raisable > 0) return { label: `Baby Shelf: ${formatMoney(raisable)} Left`, colorClass: AMBER };
  return { label: 'Baby Shelf Exhausted', colorClass: RED };
}

// Returns a label + color class for a warrant's current status (In Play / Not In Play).
// Depends on current stock price to determine if the exercise price has been crossed.
// colorClass is text-only (no border/bg) so the same color can apply to both the
// status label and the strike-price cell.
export function getWarrantStatus(
  warrant: ResearchSnapshotWarrant,
  currentPrice: number | null,
): { label: string; colorClass: string } {
  const today = new Date().toISOString().slice(0, 10);
  const registered = warrant.registered ?? '';
  const exercisePrice = warrant.exercisePrice;
  const remaining = warrant.remaining;

  const RED = 'text-rose-500';
  const YELLOW = 'text-amber-400';
  const GREEN = 'text-emerald-400';

  if (warrant.isPrefunded) return { label: 'Not In Play', colorClass: RED };
  if (remaining !== null && remaining <= 0) return { label: 'Not In Play', colorClass: RED };
  if (!warrant.exercisableDate) return { label: 'Not In Play', colorClass: RED };
  if (warrant.expirationDate && warrant.expirationDate < today) return { label: 'Not In Play', colorClass: RED };
  if (warrant.exercisableDate > today) return { label: 'Not In Play', colorClass: RED };
  if (registered !== 'Registered') return { label: 'Not In Play', colorClass: RED };
  if (currentPrice !== null && exercisePrice !== null && currentPrice >= exercisePrice) {
    return { label: 'In Play', colorClass: GREEN };
  }
  return { label: 'Potentially in Play', colorClass: YELLOW };
}

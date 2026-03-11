export function hasExplicitTimezone(input: string): boolean {
  return /(Z|[+-]\d{2}:?\d{2})$/i.test(input.trim());
}

export function parseAbsoluteTimestampMs(input: string | Date | null | undefined): number | null {
  if (input == null) return null;

  if (input instanceof Date) {
    const value = input.getTime();
    return Number.isFinite(value) ? value : null;
  }

  const raw = String(input).trim();
  if (!raw) return null;

  if (/^\d{10,13}$/.test(raw)) {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return null;
    return raw.length === 10 ? numeric * 1000 : numeric;
  }

  if (!hasExplicitTimezone(raw)) return null;

  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

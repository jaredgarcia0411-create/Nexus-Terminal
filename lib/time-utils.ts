export function hasExplicitTimezone(input: string): boolean {
  return /(Z|[+-]\d{2}:?\d{2})$/i.test(input.trim());
}

const NY_TIME_ZONE = 'America/New_York';
const NY_DATE_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: NY_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const NY_WEEKDAY = new Intl.DateTimeFormat('en-US', {
  timeZone: NY_TIME_ZONE,
  weekday: 'short',
});

type DatePartMap = Record<string, string>;

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

export function normalizeTimestamp(value: unknown): string | null {
  const parsed = parseAbsoluteTimestampMs(value as string | Date | null | undefined);
  return parsed == null ? null : new Date(parsed).toISOString();
}

export function parseSortKey(sortKey: string): { year: number; month: number; day: number } | null {
  const match = sortKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

export function parseClockTime(time: string): { hours: number; minutes: number; seconds: number } | null {
  const match = String(time ?? '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) return null;
  return { hours, minutes, seconds };
}

export function getNyOffsetMs(atEpochMs: number): number {
  const parts = NY_DATE_PARTS.formatToParts(new Date(atEpochMs));
  const map: DatePartMap = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }

  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );

  return asUtc - atEpochMs;
}

export function isNyTradingDay(sortKey: string): boolean {
  const start = nyDateTimeToEpoch(sortKey, '00:00:00');
  if (start == null) return false;

  const weekday = NY_WEEKDAY.format(new Date(start));
  return weekday !== 'Sat' && weekday !== 'Sun';
}

export function getPreviousTradingSession(sortKey: string): string | null {
  const start = nyDateTimeToEpoch(sortKey, '00:00:00');
  if (start == null) return null;

  let cursor = start;
  for (let safety = 0; safety < 14; safety += 1) {
    cursor -= 24 * 60 * 60 * 1000;
    const candidate = epochToNySortKey(cursor);
    if (isNyTradingDay(candidate)) return candidate;
  }

  return null;
}

export function normalizeToTradingSession(sortKey: string): {
  requestedSortKey: string;
  resolvedSortKey: string;
  wasAdjusted: boolean;
} | null {
  if (!parseSortKey(sortKey)) return null;

  if (isNyTradingDay(sortKey)) {
    return {
      requestedSortKey: sortKey,
      resolvedSortKey: sortKey,
      wasAdjusted: false,
    };
  }

  const previous = getPreviousTradingSession(sortKey);
  if (previous == null) return null;

  return {
    requestedSortKey: sortKey,
    resolvedSortKey: previous,
    wasAdjusted: true,
  };
}

export type SessionWindow = {
  startDate: string;
  endDate: string;
  sessionSortKey: string;
  priorSessionSortKey?: string;
};

export function getIntradaySessionWindow(
  sortKey: string,
  includePriorSession = false,
): SessionWindow | null {
  const session = normalizeToTradingSession(sortKey);
  if (session == null) return null;

  const endDate = nyDateTimeToEpoch(session.resolvedSortKey, '20:00:00');
  if (endDate == null) return null;

  const startSortKey = includePriorSession ? getPreviousTradingSession(session.resolvedSortKey) : null;
  const startDateKey = startSortKey ?? session.resolvedSortKey;

  const startDate = nyDateTimeToEpoch(startDateKey, '04:00:00');
  if (startDate == null) return null;

  return {
    startDate: String(startDate),
    endDate: String(endDate),
    sessionSortKey: session.resolvedSortKey,
    ...(startSortKey ? { priorSessionSortKey: startSortKey } : {}),
  };
}

export function nyDateTimeToEpoch(sortKey: string, time: string): number | null {
  const dateParts = parseSortKey(sortKey);
  const timeParts = parseClockTime(time);
  if (!dateParts || !timeParts) return null;

  const utcGuess = Date.UTC(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    timeParts.hours,
    timeParts.minutes,
    timeParts.seconds,
  );

  return utcGuess - getNyOffsetMs(utcGuess);
}

export function epochToNySortKey(epochMs: number): string {
  const parts = NY_DATE_PARTS.formatToParts(new Date(epochMs));
  const map: DatePartMap = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return `${map.year}-${map.month}-${map.day}`;
}

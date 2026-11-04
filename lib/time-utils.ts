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

// Full-day NYSE closures. Extend this list each year (nyse.com/markets/hours-calendars).
const NYSE_HOLIDAYS = new Set([
  '2024-01-01', '2024-01-15', '2024-02-19', '2024-03-29', '2024-05-27', '2024-06-19',
  '2024-07-04', '2024-09-02', '2024-11-28', '2024-12-25',
  '2025-01-01', '2025-01-09', '2025-01-20', '2025-02-17', '2025-04-18', '2025-05-26',
  '2025-06-19', '2025-07-04', '2025-09-01', '2025-11-27', '2025-12-25',
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19',
  '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18',
  '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

// 13:00 ET early closes (day before Independence Day, day after Thanksgiving, Christmas Eve).
// Extend alongside NYSE_HOLIDAYS. 2026-07-03 and 2027-12-24 are full holidays, so no early close that week.
const NYSE_EARLY_CLOSES = new Set([
  '2024-07-03', '2024-11-29', '2024-12-24',
  '2025-07-03', '2025-11-28', '2025-12-24',
  '2026-11-27', '2026-12-24',
  '2027-11-26',
]);

export const NY_REGULAR_OPEN = '09:30:00';
export const NY_REGULAR_CLOSE = '16:00:00';
export const NY_EARLY_CLOSE = '13:00:00';
export const NY_EXTENDED_OPEN = '04:00:00';
export const NY_EXTENDED_CLOSE = '20:00:00';
export const NY_EARLY_EXTENDED_CLOSE = '17:00:00';

export function isNyTradingDay(sortKey: string): boolean {
  const start = nyDateTimeToEpoch(sortKey, '00:00:00');
  if (start == null) return false;

  const weekday = NY_WEEKDAY.format(new Date(start));
  return weekday !== 'Sat' && weekday !== 'Sun' && !NYSE_HOLIDAYS.has(sortKey);
}

export function isNyEarlyCloseDay(sortKey: string): boolean {
  return NYSE_EARLY_CLOSES.has(sortKey) && isNyTradingDay(sortKey);
}

// Regular-session close for the date: 13:00 on half days, 16:00 otherwise.
export function getNyRegularCloseTime(sortKey: string): string {
  return isNyEarlyCloseDay(sortKey) ? NY_EARLY_CLOSE : NY_REGULAR_CLOSE;
}

// After-hours trading ends four hours after the regular close: 17:00 on half days, 20:00 otherwise.
export function getNyExtendedCloseTime(sortKey: string): string {
  return isNyEarlyCloseDay(sortKey) ? NY_EARLY_EXTENDED_CLOSE : NY_EXTENDED_CLOSE;
}

// Calendar arithmetic on a YYYY-MM-DD key. Done in UTC so a DST day (23 or 25 hours in New York)
// still counts as exactly one step.
export function shiftCalendarDays(sortKey: string, days: number): string | null {
  const parts = parseSortKey(sortKey);
  if (!parts) return null;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// The most recent NY session whose regular hours have already ended at `nowMs`: today once the
// close (16:00, or 13:00 on half days) has passed, otherwise the previous trading day.
export function getLatestClosedTradingSession(nowMs = Date.now()): string | null {
  const today = epochToNySortKey(nowMs);
  if (isNyTradingDay(today)) {
    const close = nyDateTimeToEpoch(today, getNyRegularCloseTime(today));
    if (close != null && nowMs >= close) return today;
  }
  return getPreviousTradingSession(today);
}

// Step by calendar day rather than by 24 hours of epoch time: across a DST change a New York day is
// 23 or 25 hours long, so a 24-hour step lands on the wrong date (23:00 of the day before).
export function getPreviousTradingSession(sortKey: string): string | null {
  if (!parseSortKey(sortKey)) return null;

  let cursor = sortKey;
  for (let safety = 0; safety < 14; safety += 1) {
    const candidate = shiftCalendarDays(cursor, -1);
    if (candidate == null) return null;
    if (isNyTradingDay(candidate)) return candidate;
    cursor = candidate;
  }

  return null;
}

export function getNextTradingSession(sortKey: string): string | null {
  if (!parseSortKey(sortKey)) return null;

  let cursor = sortKey;
  for (let safety = 0; safety < 14; safety += 1) {
    const candidate = shiftCalendarDays(cursor, 1);
    if (candidate == null) return null;
    if (isNyTradingDay(candidate)) return candidate;
    cursor = candidate;
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
  priorSessions = 0,
): SessionWindow | null {
  const session = normalizeToTradingSession(sortKey);
  if (session == null) return null;

  const endDate = nyDateTimeToEpoch(session.resolvedSortKey, '20:00:00');
  if (endDate == null) return null;

  // Walk back `priorSessions` trading days to find the window's start session.
  let startSortKey: string | null = null;
  let cursor = session.resolvedSortKey;
  for (let i = 0; i < priorSessions; i += 1) {
    const prev = getPreviousTradingSession(cursor);
    if (prev == null) break;
    cursor = prev;
    startSortKey = prev;
  }
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

  const wallClockAsUtc = Date.UTC(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    timeParts.hours,
    timeParts.minutes,
    timeParts.seconds,
  );

  // The offset must be read at the instant we are solving for, not at the wall-clock value read as
  // UTC. Those differ when a DST change falls between them (03:00-06:59 on the spring-forward day,
  // 02:00-05:59 on the fall-back day), which made the old single pass an hour off. Two passes settle
  // on the right offset; a non-existent spring-forward time (02:30) resolves to the instant an hour
  // later, and an ambiguous fall-back time (01:30) resolves to its first, daylight-time occurrence.
  const firstGuess = wallClockAsUtc - getNyOffsetMs(wallClockAsUtc);
  const secondGuess = wallClockAsUtc - getNyOffsetMs(firstGuess);
  if (secondGuess === firstGuess) return firstGuess;

  const thirdGuess = wallClockAsUtc - getNyOffsetMs(secondGuess);
  if (thirdGuess === secondGuess) return secondGuess;
  return Math.max(secondGuess, thirdGuess);
}

export function epochToNySortKey(epochMs: number): string {
  const parts = NY_DATE_PARTS.formatToParts(new Date(epochMs));
  const map: DatePartMap = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return `${map.year}-${map.month}-${map.day}`;
}

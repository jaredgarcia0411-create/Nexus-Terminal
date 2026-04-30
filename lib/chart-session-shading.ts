import { getPreviousTradingSession, isNyTradingDay, nyDateTimeToEpoch, parseSortKey } from '@/lib/time-utils';

export type SessionShadeSegment = {
  key: string;
  start: number;
  end: number;
};

export type SessionShadeRect = {
  key: string;
  left: number;
  width: number;
};

type TimedCandle = {
  datetime: number;
};

function toEpoch(sortKey: string, time: string) {
  return nyDateTimeToEpoch(sortKey, time);
}

function shiftCalendarDays(dateKey: string, days: number) {
  const parsed = parseSortKey(dateKey);
  if (!parsed) return null;

  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getNextTradingSession(sortKey: string): string | null {
  let cursor = sortKey;
  for (let safety = 0; safety < 14; safety += 1) {
    const next = shiftCalendarDays(cursor, 1);
    if (next == null) return null;
    if (isNyTradingDay(next)) return next;
    cursor = next;
  }

  return null;
}

function addSegment(
  segments: SessionShadeSegment[],
  key: string,
  start: number | null,
  end: number | null,
) {
  if (start == null || end == null || end <= start) return;
  segments.push({ key, start, end });
}

export function buildExtendedHoursShadeSegments(dayKeys: Iterable<string>): SessionShadeSegment[] {
  const sortedDayKeys = [...new Set(dayKeys)].sort();
  if (sortedDayKeys.length === 0) return [];

  const segments: SessionShadeSegment[] = [];
  const seen = new Set<string>();

  const addOvernightSegment = (sessionKey: string, nextSessionKey: string) => {
    const key = `${sessionKey}:overnight:${nextSessionKey}`;
    if (seen.has(key)) return;
    seen.add(key);
    addSegment(
      segments,
      key,
      toEpoch(sessionKey, '16:00:00'),
      toEpoch(nextSessionKey, '09:30:00'),
    );
  };

  sortedDayKeys.forEach((dayKey) => {
    const previousSessionKey = getPreviousTradingSession(dayKey);
    if (previousSessionKey != null) {
      addOvernightSegment(previousSessionKey, dayKey);
    }

    const nextSessionKey = getNextTradingSession(dayKey);
    if (nextSessionKey != null) {
      addOvernightSegment(dayKey, nextSessionKey);
    }
  });

  return segments;
}

function lowerBound(candles: readonly TimedCandle[], target: number) {
  let left = 0;
  let right = candles.length;

  while (left < right) {
    const middle = Math.floor((left + right) / 2);
    if (candles[middle]!.datetime < target) left = middle + 1;
    else right = middle;
  }

  return left;
}

function upperBound(candles: readonly TimedCandle[], target: number) {
  let left = 0;
  let right = candles.length;

  while (left < right) {
    const middle = Math.floor((left + right) / 2);
    if (candles[middle]!.datetime <= target) left = middle + 1;
    else right = middle;
  }

  return left;
}

function edgeCoordinate(
  candles: readonly TimedCandle[],
  index: number,
  side: 'left' | 'right',
  timeToCoordinate: (epochMs: number) => number | null,
) {
  const current = timeToCoordinate(candles[index]!.datetime);
  if (current == null) return null;

  const adjacentIndex = side === 'left' ? index - 1 : index + 1;
  const adjacent = adjacentIndex >= 0 && adjacentIndex < candles.length
    ? timeToCoordinate(candles[adjacentIndex]!.datetime)
    : null;

  const fallbackIndex = side === 'left' ? index + 1 : index - 1;
  const fallback = fallbackIndex >= 0 && fallbackIndex < candles.length
    ? timeToCoordinate(candles[fallbackIndex]!.datetime)
    : null;

  const spacing = adjacent != null
    ? Math.abs(current - adjacent)
    : fallback != null
      ? Math.abs(current - fallback)
      : 0;

  const halfBar = spacing > 0 ? spacing / 2 : 0;
  return side === 'left' ? current - halfBar : current + halfBar;
}

export function buildSessionShadeRects({
  candles,
  segments,
  visibleStart,
  visibleEnd,
  viewportWidth,
  timeToCoordinate,
}: {
  candles: readonly TimedCandle[];
  segments: readonly SessionShadeSegment[];
  visibleStart: number | null;
  visibleEnd: number | null;
  viewportWidth: number;
  timeToCoordinate: (epochMs: number) => number | null;
}): SessionShadeRect[] {
  if (candles.length === 0 || !Number.isFinite(viewportWidth) || viewportWidth <= 0) return [];

  const first = candles[0]?.datetime;
  const last = candles[candles.length - 1]?.datetime;
  if (!Number.isFinite(first) || !Number.isFinite(last)) return [];

  const rects: SessionShadeRect[] = [];
  for (const segment of segments) {
    if (segment.end <= first || segment.start >= last) continue;

    let clippedStart = Math.max(segment.start, first);
    let clippedEnd = Math.min(segment.end, last);
    if (visibleStart != null && visibleEnd != null) {
      clippedStart = Math.max(clippedStart, visibleStart);
      clippedEnd = Math.min(clippedEnd, visibleEnd);
    }
    if (clippedEnd <= clippedStart) continue;

    const firstIndex = lowerBound(candles, clippedStart);
    const lastIndex = upperBound(candles, clippedEnd) - 1;
    if (firstIndex >= candles.length || lastIndex < firstIndex) continue;

    const leftRaw = edgeCoordinate(candles, firstIndex, 'left', timeToCoordinate);
    const rightRaw = edgeCoordinate(candles, lastIndex, 'right', timeToCoordinate);
    if (leftRaw == null || rightRaw == null) continue;

    const left = Math.max(0, Math.min(Math.min(leftRaw, rightRaw), viewportWidth));
    const right = Math.max(0, Math.min(Math.max(leftRaw, rightRaw), viewportWidth));
    const width = right - left;
    if (width <= 0) continue;

    rects.push({ key: segment.key, left, width });
  }

  return rects;
}

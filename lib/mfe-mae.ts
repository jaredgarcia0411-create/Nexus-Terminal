import type { Direction } from '@/lib/types';
import type { CandleData } from '@/components/trading/CandlestickChart';

export interface MfeMaeResult {
  mfe: number;
  mae: number;
  bestExitPnl: number;
  exitEfficiency: number;
}

function parseTimeToSeconds(value: string): number | null {
  const parts = value.split(':');
  if (parts.length < 2 || parts.length > 3) return null;

  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  const seconds = Number(parts[2] ?? '0');
  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59 ||
    seconds < 0 ||
    seconds > 59
  ) {
    return null;
  }

  return (hours * 60 + minutes) * 60 + seconds;
}

const NY_DATE_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function getNyDateParts(atEpochMs: number) {
  const parts = NY_DATE_PARTS.formatToParts(new Date(atEpochMs));
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }

  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  return { year, month, day };
}

function getNyOffsetMs(atEpochMs: number) {
  const parts = NY_DATE_PARTS.formatToParts(new Date(atEpochMs));
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
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

function nyDateTimeToEpoch(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
  seconds: number,
) {
  const utcGuess = Date.UTC(year, month - 1, day, hours, minutes, seconds);
  const offset = getNyOffsetMs(utcGuess);
  return utcGuess - offset;
}

function secondsToClockParts(secondsInDay: number) {
  const hours = Math.floor(secondsInDay / 3600);
  const minutes = Math.floor((secondsInDay % 3600) / 60);
  const seconds = secondsInDay % 60;
  return { hours, minutes, seconds };
}

function resolveWindowEpochRange(
  candles: CandleData[],
  entrySec: number,
  exitSec: number,
) {
  if (candles.length === 0 || exitSec < entrySec) return null;

  const firstCandle = [...candles].sort((a, b) => a.datetime - b.datetime)[0];
  const dateParts = getNyDateParts(firstCandle.datetime);
  if (!dateParts) return null;

  const entryClock = secondsToClockParts(entrySec);
  const exitClock = secondsToClockParts(exitSec);

  const windowStartMs = nyDateTimeToEpoch(
    dateParts.year,
    dateParts.month,
    dateParts.day,
    entryClock.hours,
    entryClock.minutes,
    entryClock.seconds,
  );
  const windowEndMs = nyDateTimeToEpoch(
    dateParts.year,
    dateParts.month,
    dateParts.day,
    exitClock.hours,
    exitClock.minutes,
    exitClock.seconds,
  );

  if (windowEndMs < windowStartMs) return null;

  return { windowStartMs, windowEndMs };
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function calculateMfeMae(
  direction: Direction,
  avgEntryPrice: number,
  totalQuantity: number,
  entryTime: string,
  exitTime: string,
  commission: number,
  fees: number,
  netPnl: number,
  candles: CandleData[],
): MfeMaeResult | null {
  const entrySec = parseTimeToSeconds(entryTime);
  const exitSec = parseTimeToSeconds(exitTime);
  if (entrySec == null || exitSec == null || candles.length === 0 || totalQuantity <= 0) {
    return null;
  }

  const windowRange = resolveWindowEpochRange(candles, entrySec, exitSec);
  if (!windowRange) return null;

  const inWindow = candles.filter((candle) => {
    return candle.datetime >= windowRange.windowStartMs && candle.datetime <= windowRange.windowEndMs;
  });
  if (inWindow.length === 0) return null;

  let mfe = 0;
  let mae = 0;
  if (direction === 'LONG') {
    const maxHigh = Math.max(...inWindow.map((candle) => candle.high));
    const minLow = Math.min(...inWindow.map((candle) => candle.low));
    mfe = Math.max(0, (maxHigh - avgEntryPrice) * totalQuantity);
    mae = Math.max(0, (avgEntryPrice - minLow) * totalQuantity);
  } else {
    const minLow = Math.min(...inWindow.map((candle) => candle.low));
    const maxHigh = Math.max(...inWindow.map((candle) => candle.high));
    mfe = Math.max(0, (avgEntryPrice - minLow) * totalQuantity);
    mae = Math.max(0, (maxHigh - avgEntryPrice) * totalQuantity);
  }

  const bestExitPnl = mfe - commission - fees;
  const exitEfficiency = netPnl > 0 && mfe > 0 ? clamp01(netPnl / mfe) : 0;

  return { mfe, mae, bestExitPnl, exitEfficiency };
}

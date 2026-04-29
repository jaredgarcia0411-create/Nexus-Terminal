import type { Time } from 'lightweight-charts';

const NY_TIME_ZONE = 'America/New_York';

const NY_INTRADAY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: NY_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const NY_DAY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: NY_TIME_ZONE,
  month: 'short',
  day: 'numeric',
});

const NY_CROSSHAIR_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: NY_TIME_ZONE,
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function toEpochMs(time: Time | null | undefined): number | null {
  if (time == null) return null;
  if (typeof time === 'number') return Number.isFinite(time) ? time * 1000 : null;

  if (typeof time === 'string') {
    const parsed = Date.parse(time);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (time && typeof time === 'object') {
    const businessDay = time as { year?: number; month?: number; day?: number };
    if (
      Number.isFinite(businessDay.year)
      && Number.isFinite(businessDay.month)
      && Number.isFinite(businessDay.day)
    ) {
      return Date.UTC(Number(businessDay.year), Number(businessDay.month) - 1, Number(businessDay.day));
    }
  }

  return null;
}

export function formatNyTime(time: Time, showTime: boolean): string {
  const epochMs = toEpochMs(time);
  if (epochMs == null) return '';
  const date = new Date(epochMs);
  return showTime ? NY_INTRADAY_FORMATTER.format(date) : NY_DAY_FORMATTER.format(date);
}

export function formatNyCrosshair(time: Time): string {
  const epochMs = toEpochMs(time);
  if (epochMs == null) return '';
  return NY_CROSSHAIR_FORMATTER.format(new Date(epochMs));
}

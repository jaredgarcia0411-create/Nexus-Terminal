import { describe, expect, it } from 'vitest';

import {
  getIntradaySessionWindow,
  getNextTradingSession,
  getNyExtendedCloseTime,
  getNyRegularCloseTime,
  getPreviousTradingSession,
  epochToNySortKey,
  hasExplicitTimezone,
  isNyEarlyCloseDay,
  isNyTradingDay,
  normalizeToTradingSession,
  nyDateTimeToEpoch,
  parseAbsoluteTimestampMs,
  shiftCalendarDays,
} from '@/lib/time-utils';

describe('time-utils', () => {
  it('detects explicit timezone suffixes', () => {
    expect(hasExplicitTimezone('2026-03-06T14:35:00.000Z')).toBe(true);
    expect(hasExplicitTimezone('2026-03-06T09:35:00-05:00')).toBe(true);
    expect(hasExplicitTimezone('2026-03-06T09:35:00-0500')).toBe(true);
    expect(hasExplicitTimezone('2026-03-06 09:35:00')).toBe(false);
  });

  it('parses explicit timezone timestamps and rejects ambiguous local strings', () => {
    expect(parseAbsoluteTimestampMs('2026-03-06T14:35:00.000Z')).toBe(1772807700000);
    expect(parseAbsoluteTimestampMs('2026-03-06T09:35:00-05:00')).toBe(1772807700000);
    expect(parseAbsoluteTimestampMs('2026-03-06 09:35:00')).toBeNull();
  });

  it('parses epoch strings and Date values', () => {
    expect(parseAbsoluteTimestampMs('1772807700')).toBe(1772807700000);
    expect(parseAbsoluteTimestampMs('1772807700000')).toBe(1772807700000);
    expect(parseAbsoluteTimestampMs(new Date('2026-03-06T14:35:00.000Z'))).toBe(1772807700000);
  });

  it('converts NY date/time to epoch through DST boundaries', () => {
    const beforeDst = nyDateTimeToEpoch('2026-03-06', '09:30:00');
    const afterDst = nyDateTimeToEpoch('2026-03-10', '09:30:00');

    expect(beforeDst).toBe(Date.parse('2026-03-06T09:30:00-05:00'));
    expect(afterDst).toBe(Date.parse('2026-03-10T09:30:00-04:00'));
  });

  it('generates NY sort keys from UTC timestamps', () => {
    expect(epochToNySortKey(Date.parse('2026-03-10T13:30:00.000Z'))).toBe('2026-03-10');
    expect(epochToNySortKey(Date.parse('2026-03-10T00:30:00.000Z'))).toBe('2026-03-09');
  });

  it('normalizes weekend dates to previous trading day', () => {
    const adjusted = normalizeToTradingSession('2026-03-07'); // Saturday
    expect(adjusted).toMatchObject({
      requestedSortKey: '2026-03-07',
      resolvedSortKey: '2026-03-06',
      wasAdjusted: true,
    });
  });

  it('finds the next trading session', () => {
    expect(getNextTradingSession('2026-03-04')).toBe('2026-03-05');
    expect(getNextTradingSession('2026-03-06')).toBe('2026-03-09');
  });

  it('skips NYSE holidays', () => {
    expect(isNyTradingDay('2025-01-09')).toBe(false);
    expect(getNextTradingSession('2025-01-08')).toBe('2025-01-10');
    expect(getNextTradingSession('2025-01-17')).toBe('2025-01-21');
    expect(getNextTradingSession('2026-07-02')).toBe('2026-07-06');
  });

  it('builds intraday session windows with prior day support', () => {
    expect(getIntradaySessionWindow('2026-03-06', 1)).toEqual({
      startDate: String(nyDateTimeToEpoch('2026-03-05', '04:00:00')),
      endDate: String(nyDateTimeToEpoch('2026-03-06', '20:00:00')),
      sessionSortKey: '2026-03-06',
      priorSessionSortKey: '2026-03-05',
    });

    expect(getIntradaySessionWindow('2026-03-07', 1)).toEqual({
      startDate: String(nyDateTimeToEpoch('2026-03-05', '04:00:00')),
      endDate: String(nyDateTimeToEpoch('2026-03-06', '20:00:00')),
      sessionSortKey: '2026-03-06',
      priorSessionSortKey: '2026-03-05',
    });

    expect(getIntradaySessionWindow('2026-03-06', 0)).toEqual({
      startDate: String(nyDateTimeToEpoch('2026-03-06', '04:00:00')),
      endDate: String(nyDateTimeToEpoch('2026-03-06', '20:00:00')),
      sessionSortKey: '2026-03-06',
    });
  });
});

// US DST in 2026: clocks jump 02:00 -> 03:00 on Sunday 2026-03-08 and fall back 02:00 -> 01:00 on
// Sunday 2026-11-01. 2025 changed on 03-09 and 11-02.
describe('time-utils around DST changes', () => {
  it.each([
    // Wall-clock times on the change days themselves, where a single-pass offset lookup was an hour off.
    ['2026-03-08', '00:30:00', '2026-03-08T00:30:00-05:00'],
    ['2026-03-08', '03:00:00', '2026-03-08T03:00:00-04:00'],
    ['2026-03-08', '04:00:00', '2026-03-08T04:00:00-04:00'],
    ['2026-03-08', '06:59:00', '2026-03-08T06:59:00-04:00'],
    ['2026-03-08', '09:30:00', '2026-03-08T09:30:00-04:00'],
    ['2026-11-01', '00:00:00', '2026-11-01T00:00:00-04:00'],
    ['2026-11-01', '02:00:00', '2026-11-01T02:00:00-05:00'],
    ['2026-11-01', '04:00:00', '2026-11-01T04:00:00-05:00'],
    ['2026-11-01', '05:59:00', '2026-11-01T05:59:00-05:00'],
    ['2026-11-01', '16:00:00', '2026-11-01T16:00:00-05:00'],
    ['2025-03-09', '04:00:00', '2025-03-09T04:00:00-04:00'],
    ['2025-11-02', '04:00:00', '2025-11-02T04:00:00-05:00'],
    // The trading days on either side keep their own offsets.
    ['2026-03-06', '04:00:00', '2026-03-06T04:00:00-05:00'],
    ['2026-03-09', '04:00:00', '2026-03-09T04:00:00-04:00'],
    ['2026-03-09', '20:00:00', '2026-03-09T20:00:00-04:00'],
    ['2026-10-30', '16:00:00', '2026-10-30T16:00:00-04:00'],
    ['2026-11-02', '04:00:00', '2026-11-02T04:00:00-05:00'],
    ['2026-11-02', '09:30:00', '2026-11-02T09:30:00-05:00'],
  ])('maps %s %s ET to the right instant', (date, time, expectedIso) => {
    expect(nyDateTimeToEpoch(date, time)).toBe(Date.parse(expectedIso));
  });

  it('resolves the skipped spring-forward hour forward and the repeated fall-back hour to its first pass', () => {
    // 02:30 never happens on 2026-03-08; treat it as 03:30 EDT like JavaScript Date does.
    expect(nyDateTimeToEpoch('2026-03-08', '02:30:00')).toBe(Date.parse('2026-03-08T03:30:00-04:00'));
    // 01:30 happens twice on 2026-11-01; take the earlier, daylight-time instant.
    expect(nyDateTimeToEpoch('2026-11-01', '01:30:00')).toBe(Date.parse('2026-11-01T01:30:00-04:00'));
  });

  it('round-trips midnight on every day of a DST week', () => {
    for (const date of ['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']) {
      const midnight = nyDateTimeToEpoch(date, '00:00:00')!;
      expect(epochToNySortKey(midnight)).toBe(date);
      expect(epochToNySortKey(midnight - 1)).toBe(shiftCalendarDays(date, -1));
    }
  });

  it('steps trading sessions across DST weekends without skipping or repeating a date', () => {
    expect(getPreviousTradingSession('2026-03-09')).toBe('2026-03-06');
    expect(getNextTradingSession('2026-03-06')).toBe('2026-03-09');
    expect(getPreviousTradingSession('2026-11-02')).toBe('2026-10-30');
    expect(getNextTradingSession('2026-10-30')).toBe('2026-11-02');
    expect(getPreviousTradingSession('2025-03-10')).toBe('2025-03-07');
    expect(getNextTradingSession('2025-10-31')).toBe('2025-11-03');
    // Stepping over the change day itself.
    expect(getNextTradingSession('2026-03-08')).toBe('2026-03-09');
    expect(getPreviousTradingSession('2026-03-08')).toBe('2026-03-06');
    expect(getNextTradingSession('2026-11-01')).toBe('2026-11-02');
    expect(getPreviousTradingSession('2026-11-01')).toBe('2026-10-30');
  });

  it('builds a two-session intraday window that spans the spring-forward weekend', () => {
    expect(getIntradaySessionWindow('2026-03-09', 1)).toEqual({
      startDate: String(Date.parse('2026-03-06T04:00:00-05:00')),
      endDate: String(Date.parse('2026-03-09T20:00:00-04:00')),
      sessionSortKey: '2026-03-09',
      priorSessionSortKey: '2026-03-06',
    });
    expect(getIntradaySessionWindow('2026-11-01', 0)).toEqual({
      startDate: String(Date.parse('2026-10-30T04:00:00-04:00')),
      endDate: String(Date.parse('2026-10-30T20:00:00-04:00')),
      sessionSortKey: '2026-10-30',
    });
  });

  it('shifts calendar days in whole days across DST and month ends', () => {
    expect(shiftCalendarDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(shiftCalendarDays('2026-11-01', -1)).toBe('2026-10-31');
    expect(shiftCalendarDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(shiftCalendarDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(shiftCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftCalendarDays('2026-13-01', 1)).toBeNull();
  });
});

describe('time-utils holidays and half days', () => {
  it('knows the 2026 and 2027 NYSE closures', () => {
    for (const holiday of ['2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03',
      '2026-09-07', '2026-11-26', '2026-12-25', '2027-01-01', '2027-06-18', '2027-07-05', '2027-12-24']) {
      expect(isNyTradingDay(holiday), holiday).toBe(false);
    }
    expect(isNyTradingDay('2026-11-27')).toBe(true);
    expect(getPreviousTradingSession('2026-11-27')).toBe('2026-11-25');
    expect(getNextTradingSession('2026-12-24')).toBe('2026-12-28');
    expect(getNextTradingSession('2027-12-23')).toBe('2027-12-27');
  });

  it('closes at 13:00 on half days and 16:00 otherwise', () => {
    expect(isNyEarlyCloseDay('2026-11-27')).toBe(true);
    expect(isNyEarlyCloseDay('2026-12-24')).toBe(true);
    expect(isNyEarlyCloseDay('2025-07-03')).toBe(true);
    expect(isNyEarlyCloseDay('2026-07-02')).toBe(false);
    expect(isNyEarlyCloseDay('2026-11-25')).toBe(false);
    expect(getNyRegularCloseTime('2026-11-27')).toBe('13:00:00');
    expect(getNyRegularCloseTime('2026-11-30')).toBe('16:00:00');
    expect(getNyExtendedCloseTime('2026-12-24')).toBe('17:00:00');
    expect(getNyExtendedCloseTime('2026-12-28')).toBe('20:00:00');
  });
});

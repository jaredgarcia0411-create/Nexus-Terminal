import { describe, expect, it } from 'vitest';

import {
  epochToNySortKey,
  hasExplicitTimezone,
  nyDateTimeToEpoch,
  parseAbsoluteTimestampMs,
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
});

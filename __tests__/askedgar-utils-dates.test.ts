import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { formatDate, getWarrantStatus } from '@/lib/askedgar-utils';

// Node re-reads process.env.TZ at runtime, so each block runs the formatter as a viewer in that zone.
function describeInTimeZone(timeZone: string, run: () => void) {
  describe(`viewed from ${timeZone}`, () => {
    let previous: string | undefined;
    beforeAll(() => {
      previous = process.env.TZ;
      process.env.TZ = timeZone;
    });
    afterAll(() => {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    });
    run();
  });
}

describe('askedgar-utils formatDate', () => {
  for (const timeZone of ['America/New_York', 'America/Los_Angeles', 'UTC', 'Asia/Tokyo']) {
    describeInTimeZone(timeZone, () => {
      it('shows a bare calendar date on its own day', () => {
        expect(formatDate('2026-05-15')).toBe('5/15/2026');
        // Across the DST changes too.
        expect(formatDate('2026-03-08')).toBe('3/8/2026');
        expect(formatDate('2026-11-01')).toBe('11/1/2026');
        expect(formatDate('2026-01-01')).toBe('1/1/2026');
      });
    });
  }

  it('leaves unparseable and empty values displayable', () => {
    expect(formatDate('')).toBe('--');
    expect(formatDate(null)).toBe('--');
    expect(formatDate('not a date')).toBe('not a date');
  });
});

describe('askedgar-utils getWarrantStatus', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('compares warrant dates against the New York day, not the UTC day', () => {
    const warrant = {
      details: '', amount: 100, remaining: 100, exercisePrice: 5, prefundedCost: null, registered: 'Registered',
      exercisableDate: '2026-11-05', expirationDate: '2027-11-05', filedAt: null, isPrefunded: false, status: null, documentUrl: null,
    };
    vi.useFakeTimers();
    // 21:00 ET on 2026-11-04 is already 2026-11-05 in UTC, but the warrant isn't exercisable yet.
    vi.setSystemTime(new Date('2026-11-05T02:00:00Z'));
    expect(getWarrantStatus(warrant, 6).label).toBe('Not In Play');
    // 00:00 ET on 2026-11-05.
    vi.setSystemTime(new Date('2026-11-05T05:00:00Z'));
    expect(getWarrantStatus(warrant, 6).label).toBe('In Play');
  });
});

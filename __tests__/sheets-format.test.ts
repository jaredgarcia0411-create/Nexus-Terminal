import { describe, expect, it } from 'vitest';

import { formatCompactShares, formatCompactUsd } from '@/lib/sheets/format';

describe('sheet compact formatters', () => {
  it('formats share counts without currency markers', () => {
    expect(formatCompactShares(1_230_000)).toBe('1.23M');
    expect(formatCompactShares(545_000)).toBe('545.0K');
    expect(formatCompactShares(34_200_000)).toBe('34.2M');
  });

  it('formats dollar volume with compact currency markers', () => {
    expect(formatCompactUsd(1_200_000)).toBe('$1.2M');
    expect(formatCompactUsd(340_500)).toBe('$340.5K');
    expect(formatCompactUsd(2_100_000_000)).toBe('$2.1B');
  });

  it('returns an empty string for non-finite input', () => {
    expect(formatCompactShares(Number.NaN)).toBe('');
    expect(formatCompactUsd(Number.POSITIVE_INFINITY)).toBe('');
  });
});

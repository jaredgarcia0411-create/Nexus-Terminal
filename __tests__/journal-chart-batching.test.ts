import { describe, expect, it } from 'vitest';

import {
  resolveInitialChartCount,
  resolveLoadMoreCount,
  resolveNextChartCount,
} from '@/lib/journal-chart-batching';

describe('journal chart batching helpers', () => {
  it('uses initial batch when a day is expanded first time', () => {
    expect(resolveInitialChartCount(undefined, 4)).toBe(4);
  });

  it('keeps existing count when re-expanding a day', () => {
    expect(resolveInitialChartCount(8, 4)).toBe(8);
  });

  it('increments chart count by batch size without exceeding total', () => {
    expect(resolveNextChartCount(10, 4, 4)).toBe(8);
    expect(resolveNextChartCount(10, 8, 4)).toBe(10);
  });

  it('computes how many charts remain for load-more label', () => {
    expect(resolveLoadMoreCount(10, 4, 4)).toBe(4);
    expect(resolveLoadMoreCount(10, 8, 4)).toBe(2);
    expect(resolveLoadMoreCount(10, 10, 4)).toBe(0);
  });
});

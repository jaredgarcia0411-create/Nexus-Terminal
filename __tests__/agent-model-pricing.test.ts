import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetWarnedModelsForTests,
  estimateCostCents,
} from '@/lib/agents/model-pricing';

describe('agent model pricing', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetWarnedModelsForTests();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('returns the exact configured cost for a 1M input and 1M output token call', () => {
    expect(estimateCostCents('llama-3.3-70b-versatile', 1_000_000, 1_000_000)).toBe(138);
  });

  it('preserves fractional cents for small calls', () => {
    expect(estimateCostCents('llama-3.3-70b-versatile', 3_000, 500)).toBeCloseTo(0.2165, 4);
  });

  it('returns zero when no tokens are used', () => {
    expect(estimateCostCents('llama-3.3-70b-versatile', 0, 0)).toBe(0);
  });

  it('warns once for a repeated unknown model', () => {
    expect(estimateCostCents('unknown-xyz', 100, 100)).toBe(0);
    expect(estimateCostCents('unknown-xyz', 100, 100)).toBe(0);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain('Unknown model');
  });

  it('warns once per distinct unknown model', () => {
    expect(estimateCostCents('unknown-xyz', 100, 100)).toBe(0);
    expect(estimateCostCents('another-unknown', 100, 100)).toBe(0);

    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy.mock.calls[0]?.[0]).toContain('Unknown model');
    expect(warnSpy.mock.calls[1]?.[0]).toContain('Unknown model');
  });

  it('treats an empty model name as an unknown model and only warns once', () => {
    expect(estimateCostCents('', 100, 100)).toBe(0);
    expect(estimateCostCents('', 100, 100)).toBe(0);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain('Unknown model');
  });
});

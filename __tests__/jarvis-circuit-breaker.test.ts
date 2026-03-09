import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCircuitBreakerState,
  isCircuitOpen,
  recordLlmFailure,
  recordLlmSuccess,
  resetCircuitBreaker,
} from '@/lib/jarvis-circuit-breaker';

describe('jarvis-circuit-breaker', () => {
  beforeEach(() => {
    resetCircuitBreaker();
    delete process.env.JARVIS_CIRCUIT_BREAKER_THRESHOLD;
    delete process.env.JARVIS_CIRCUIT_BREAKER_RESET_MS;
  });

  afterEach(() => {
    vi.useRealTimers();
    resetCircuitBreaker();
  });

  it('isCircuitOpen returns false with no failures', () => {
    expect(isCircuitOpen()).toBe(false);
  });

  it('opens after threshold consecutive failures', () => {
    process.env.JARVIS_CIRCUIT_BREAKER_THRESHOLD = '3';

    recordLlmFailure();
    recordLlmFailure();
    expect(isCircuitOpen()).toBe(false);

    recordLlmFailure();
    expect(isCircuitOpen()).toBe(true);
  });

  it('recordLlmSuccess resets counter and closes breaker', () => {
    process.env.JARVIS_CIRCUIT_BREAKER_THRESHOLD = '2';

    recordLlmFailure();
    recordLlmFailure();
    expect(isCircuitOpen()).toBe(true);

    recordLlmSuccess();
    expect(isCircuitOpen()).toBe(false);
    expect(getCircuitBreakerState()).toMatchObject({
      status: 'closed',
      consecutiveFailures: 0,
      openedAt: null,
    });
  });

  it('auto-transitions to half-open after reset timeout', () => {
    vi.useFakeTimers();
    process.env.JARVIS_CIRCUIT_BREAKER_THRESHOLD = '2';
    process.env.JARVIS_CIRCUIT_BREAKER_RESET_MS = '1000';

    recordLlmFailure();
    recordLlmFailure();
    expect(isCircuitOpen()).toBe(true);

    vi.advanceTimersByTime(1001);

    expect(isCircuitOpen()).toBe(false);
    expect(getCircuitBreakerState().status).toBe('half-open');
  });

  it('half-open allows one request then re-opens on failure', () => {
    vi.useFakeTimers();
    process.env.JARVIS_CIRCUIT_BREAKER_THRESHOLD = '2';
    process.env.JARVIS_CIRCUIT_BREAKER_RESET_MS = '1000';

    recordLlmFailure();
    recordLlmFailure();
    expect(isCircuitOpen()).toBe(true);

    vi.advanceTimersByTime(1001);

    expect(isCircuitOpen()).toBe(false);
    expect(isCircuitOpen()).toBe(true);

    recordLlmFailure();
    expect(isCircuitOpen()).toBe(true);
    expect(getCircuitBreakerState().status).toBe('open');
  });

  it('resetCircuitBreaker resets full state', () => {
    process.env.JARVIS_CIRCUIT_BREAKER_THRESHOLD = '1';

    recordLlmFailure();
    expect(isCircuitOpen()).toBe(true);

    resetCircuitBreaker();
    expect(getCircuitBreakerState()).toEqual({
      status: 'closed',
      consecutiveFailures: 0,
      lastFailureAt: null,
      openedAt: null,
    });
    expect(isCircuitOpen()).toBe(false);
  });

  it('getCircuitBreakerState reports status transitions', () => {
    vi.useFakeTimers();
    process.env.JARVIS_CIRCUIT_BREAKER_THRESHOLD = '2';
    process.env.JARVIS_CIRCUIT_BREAKER_RESET_MS = '500';

    expect(getCircuitBreakerState().status).toBe('closed');
    recordLlmFailure();
    expect(getCircuitBreakerState().status).toBe('closed');

    recordLlmFailure();
    expect(getCircuitBreakerState().status).toBe('open');

    vi.advanceTimersByTime(501);
    expect(isCircuitOpen()).toBe(false);
    expect(getCircuitBreakerState().status).toBe('half-open');

    recordLlmSuccess();
    expect(getCircuitBreakerState().status).toBe('closed');
  });
});

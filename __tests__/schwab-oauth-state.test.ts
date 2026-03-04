import { describe, expect, it } from 'vitest';
import { generateSchwabOAuthState, statesMatch } from '@/lib/schwab-oauth-state';

describe('Schwab OAuth state helpers', () => {
  it('generates high-entropy URL-safe state values', () => {
    const first = generateSchwabOAuthState();
    const second = generateSchwabOAuthState();

    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(first.length).toBeGreaterThanOrEqual(32);
    expect(second.length).toBeGreaterThanOrEqual(32);
    expect(first).not.toBe(second);
  });

  it('accepts only exact state matches', () => {
    const state = generateSchwabOAuthState();

    expect(statesMatch(state, state)).toBe(true);
    expect(statesMatch(state, `${state}x`)).toBe(false);
    expect(statesMatch(state, null)).toBe(false);
    expect(statesMatch(undefined, state)).toBe(false);
  });
});

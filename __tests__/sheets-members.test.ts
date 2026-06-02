import { describe, expect, it } from 'vitest';

import { appendResearchRowSchema, memberAddSchema, memberRoleSchema, reorderRowsSchema } from '@/lib/validations/sheets';

describe('sheet member validation', () => {
  it('lowercases the email and defaults role to editor', () => {
    const parsed = memberAddSchema.parse({ email: 'Trader@Example.COM' });
    expect(parsed).toEqual({ email: 'trader@example.com', role: 'editor' });
  });

  it('rejects an invalid email', () => {
    expect(memberAddSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
  });

  it('refuses to assign the owner role', () => {
    expect(memberAddSchema.safeParse({ email: 'a@b.com', role: 'owner' }).success).toBe(false);
    expect(memberRoleSchema.safeParse({ role: 'owner' }).success).toBe(false);
  });

  it('accepts editor and viewer for a role change', () => {
    expect(memberRoleSchema.parse({ role: 'viewer' })).toEqual({ role: 'viewer' });
    expect(memberRoleSchema.parse({ role: 'editor' })).toEqual({ role: 'editor' });
  });
});

describe('append research row validation', () => {
  it('normalizes a valid row and keeps an optional report id', () => {
    const parsed = appendResearchRowSchema.parse({
      ticker: ' aapl ',
      date: '2026-06-01',
      reportId: 'report-1',
    });
    expect(parsed).toEqual({ ticker: 'AAPL', date: '2026-06-01', reportId: 'report-1' });
  });

  it('accepts rows without a report id', () => {
    expect(appendResearchRowSchema.parse({ ticker: 'TSLA', date: '2026-06-01' })).toEqual({
      ticker: 'TSLA',
      date: '2026-06-01',
    });
  });

  it('rejects invalid tickers', () => {
    expect(appendResearchRowSchema.safeParse({ ticker: 'TOO-LONG-TICKER', date: '2026-06-01' }).success)
      .toBe(false);
  });

  it('rejects invalid dates', () => {
    expect(appendResearchRowSchema.safeParse({ ticker: 'AAPL', date: '06/01/2026' }).success)
      .toBe(false);
  });
});

describe('reorder rows validation', () => {
  it('accepts a non-empty row id array', () => {
    expect(reorderRowsSchema.parse({ rowIds: ['row-1', 'row-2'] })).toEqual({
      rowIds: ['row-1', 'row-2'],
    });
  });

  it('rejects an empty row id array', () => {
    expect(reorderRowsSchema.safeParse({ rowIds: [] }).success).toBe(false);
  });
});

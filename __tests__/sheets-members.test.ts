import { describe, expect, it } from 'vitest';

import { memberAddSchema, memberRoleSchema } from '@/lib/validations/sheets';

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

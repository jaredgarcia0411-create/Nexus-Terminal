import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

type AuthorizedCallback = (args: {
  auth: { user: { email: string } } | null;
  request: { nextUrl: URL };
}) => unknown;

const captured = vi.hoisted(() => ({ authorized: null as AuthorizedCallback | null }));

// lib/auth-config.ts keeps its config private and hands it to NextAuth(), so capture it there.
vi.mock('next-auth', () => ({
  default: (config: { callbacks: { authorized: AuthorizedCallback } }) => {
    captured.authorized = config.callbacks.authorized;
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  },
}));
vi.mock('next-auth/providers/google', () => ({ default: vi.fn(() => ({ id: 'google' })) }));

function pageCheck(email: string | null, path: string) {
  return captured.authorized!({
    auth: email ? { user: { email } } : null,
    request: { nextUrl: new URL(`http://localhost${path}`) },
  });
}

describe('auth-config authorized callback', () => {
  const originalAllowedEmails = process.env.ALLOWED_EMAILS;

  beforeAll(async () => {
    await import('@/lib/auth-config');
  });

  afterEach(() => {
    if (originalAllowedEmails === undefined) delete process.env.ALLOWED_EMAILS;
    else process.env.ALLOWED_EMAILS = originalAllowedEmails;
  });

  it('lets allowed users load pages, ignoring email case', () => {
    process.env.ALLOWED_EMAILS = 'coworker@example.com';
    expect(pageCheck('coworker@example.com', '/')).toBe(true);
    expect(pageCheck('CoWorker@Example.com', '/')).toBe(true);
  });

  it('blocks a removed user who still has a session, a logged-out visitor, and everyone when the list is unset', () => {
    process.env.ALLOWED_EMAILS = 'coworker@example.com';
    expect(pageCheck('removed@example.com', '/')).toBe(false);
    expect(pageCheck(null, '/')).toBe(false);
    delete process.env.ALLOWED_EMAILS;
    expect(pageCheck('coworker@example.com', '/')).toBe(false);
  });

  it('shows the login page to a removed user instead of redirecting them in a loop', () => {
    process.env.ALLOWED_EMAILS = 'coworker@example.com';
    expect(pageCheck('removed@example.com', '/login')).toBe(true);
    expect(pageCheck('coworker@example.com', '/login')).toBeInstanceOf(Response);
  });
});

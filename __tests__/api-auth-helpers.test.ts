import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { requireAgentAdmin, requireServiceAuth, requireServiceKey } from '@/lib/agents/admin';
import { secretsMatch } from '@/lib/api-route-utils';
import { isEmailAllowed } from '@/lib/auth-allowlist';
import { requireCronSecret } from '@/lib/server-db-utils';

const ENV_KEYS = ['CRON_SECRET', 'AGENT_ADMIN_KEY', 'AGENT_SERVICE_KEY', 'ALLOWED_EMAILS'] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function requestWithHeaders(headers: Record<string, string>) {
  return new Request('http://localhost/api/test', { headers });
}

describe('secretsMatch', () => {
  it('matches only identical secrets', () => {
    expect(secretsMatch('abc123', 'abc123')).toBe(true);
    expect(secretsMatch('abc123', 'abc124')).toBe(false);
    expect(secretsMatch('abc', 'abc123')).toBe(false);
  });

  it('never matches an empty value', () => {
    expect(secretsMatch('', '')).toBe(false);
    expect(secretsMatch('abc', '')).toBe(false);
    expect(secretsMatch('', 'abc')).toBe(false);
  });
});

describe('isEmailAllowed', () => {
  it('is case-insensitive and tolerates spacing in the list', () => {
    process.env.ALLOWED_EMAILS = ' A@Example.com ,b@example.com ';
    expect(isEmailAllowed('a@example.com')).toBe(true);
    expect(isEmailAllowed('B@EXAMPLE.COM')).toBe(true);
    expect(isEmailAllowed('c@example.com')).toBe(false);
  });

  it('fails closed without an allowlist or an email', () => {
    delete process.env.ALLOWED_EMAILS;
    expect(isEmailAllowed('a@example.com')).toBe(false);
    process.env.ALLOWED_EMAILS = 'a@example.com';
    expect(isEmailAllowed(null)).toBe(false);
    expect(isEmailAllowed('')).toBe(false);
  });
});

describe('requireCronSecret', () => {
  it('returns 503 when CRON_SECRET is not configured', () => {
    delete process.env.CRON_SECRET;
    const response = requireCronSecret(requestWithHeaders({ authorization: 'Bearer anything' }));
    expect(response?.status).toBe(503);
  });

  it('rejects a missing, malformed, or wrong bearer token', () => {
    process.env.CRON_SECRET = 'cron-secret';
    expect(requireCronSecret(requestWithHeaders({}))?.status).toBe(401);
    expect(requireCronSecret(requestWithHeaders({ authorization: 'cron-secret' }))?.status).toBe(401);
    expect(requireCronSecret(requestWithHeaders({ authorization: 'Bearer cron-secre' }))?.status).toBe(401);
    expect(requireCronSecret(requestWithHeaders({ authorization: 'Bearer cron-secret-extra' }))?.status).toBe(401);
  });

  it('accepts the configured bearer token', () => {
    process.env.CRON_SECRET = 'cron-secret';
    expect(requireCronSecret(requestWithHeaders({ authorization: 'Bearer cron-secret' }))).toBeNull();
  });
});

describe('requireAgentAdmin', () => {
  it('fails closed when AGENT_ADMIN_KEY is not configured', () => {
    delete process.env.AGENT_ADMIN_KEY;
    expect(requireAgentAdmin(requestWithHeaders({ 'x-agent-admin-key': 'x' }))?.status).toBe(500);
  });

  it('rejects a wrong or missing admin key and accepts the right one', () => {
    process.env.AGENT_ADMIN_KEY = 'admin-key';
    expect(requireAgentAdmin(requestWithHeaders({}))?.status).toBe(401);
    expect(requireAgentAdmin(requestWithHeaders({ 'x-agent-admin-key': 'admin-ke' }))?.status).toBe(401);
    expect(requireAgentAdmin(requestWithHeaders({ 'x-agent-admin-key': 'admin-key' }))).toBeNull();
  });
});

describe('requireServiceKey / requireServiceAuth', () => {
  it('rejects a wrong service key and accepts the right one', () => {
    process.env.AGENT_SERVICE_KEY = 'service-key';
    expect(requireServiceKey(requestWithHeaders({ 'x-agent-service-key': 'nope' }))?.status).toBe(401);
    expect(requireServiceKey(requestWithHeaders({ 'x-agent-service-key': 'service-key' }))).toBeNull();
  });

  it('only resolves Discord users that are explicitly mapped', () => {
    process.env.AGENT_SERVICE_KEY = 'service-key';
    const request = requestWithHeaders({ 'x-agent-service-key': 'service-key' });

    const missing = requireServiceAuth(request, {});
    expect(missing instanceof Response && missing.status).toBe(400);

    const unknown = requireServiceAuth(request, { discord_user_id: '000000000000000000' });
    expect(unknown instanceof Response && unknown.status).toBe(403);

    const known = requireServiceAuth(request, { discord_user_id: '549621839350202387' });
    expect(known instanceof Response).toBe(false);
    if (!(known instanceof Response)) {
      expect(known.user.email).toContain('@');
    }
  });

  it('checks the key before looking at the Discord user', () => {
    process.env.AGENT_SERVICE_KEY = 'service-key';
    const request = requestWithHeaders({ 'x-agent-service-key': 'wrong' });
    const result = requireServiceAuth(request, { discord_user_id: '549621839350202387' });
    expect(result instanceof Response && result.status).toBe(401);
  });
});

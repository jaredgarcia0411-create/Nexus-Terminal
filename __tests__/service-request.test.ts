import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { requireServiceClaims } from '@/lib/service-request';

function base64UrlEncode(input: string) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function buildToken(payload: Record<string, unknown>, secret: string) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

  return `${signingInput}.${signature}`;
}

function buildMockDb({ replayAccepted }: { replayAccepted: boolean }) {
  return {
    delete: () => ({ where: async () => ({}) }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: async () => (replayAccepted ? [{ jti: 'jti-1' }] : []),
        }),
      }),
    }),
  } as any;
}

const ORIGINAL_ENV = {
  current: process.env.TRADE_WEBHOOK_SECRET,
  previous: process.env.TRADE_WEBHOOK_SECRET_PREVIOUS,
};

afterEach(() => {
  process.env.TRADE_WEBHOOK_SECRET = ORIGINAL_ENV.current;
  process.env.TRADE_WEBHOOK_SECRET_PREVIOUS = ORIGINAL_ENV.previous;
});

describe('requireServiceClaims', () => {
  it('rejects request missing bearer token', async () => {
    process.env.TRADE_WEBHOOK_SECRET = 'current-secret';

    const response = await requireServiceClaims(new Request('http://localhost/test'), buildMockDb({ replayAccepted: true }));
    expect('error' in response).toBe(true);
    if ('error' in response) {
      expect(response.error.status).toBe(401);
    }
  });

  it('rejects token with insufficient scope', async () => {
    process.env.TRADE_WEBHOOK_SECRET = 'current-secret';

    const now = Math.floor(Date.now() / 1000);
    const token = buildToken({
      iss: 'nexus-service',
      aud: 'nexus-api',
      iat: now,
      exp: now + 300,
      discordUserId: 'discord-1',
      scope: ['trades:read'],
      jti: 'jti-1',
    }, 'current-secret');

    const request = new Request('http://localhost/test', {
      headers: { Authorization: `Bearer ${token}` },
    });

    const response = await requireServiceClaims(request, buildMockDb({ replayAccepted: true }), {
      requiredScopes: ['alerts:write'],
    });

    expect('error' in response).toBe(true);
    if ('error' in response) {
      expect(response.error.status).toBe(403);
    }
  });

  it('rejects replayed token when replay enforcement is enabled', async () => {
    process.env.TRADE_WEBHOOK_SECRET = 'current-secret';

    const now = Math.floor(Date.now() / 1000);
    const token = buildToken({
      iss: 'nexus-service',
      aud: 'nexus-api',
      iat: now,
      exp: now + 300,
      discordUserId: 'discord-1',
      scope: ['alerts:write'],
      jti: 'jti-1',
    }, 'current-secret');

    const request = new Request('http://localhost/test', {
      headers: { Authorization: `Bearer ${token}` },
    });

    const response = await requireServiceClaims(request, buildMockDb({ replayAccepted: false }), {
      requiredScopes: ['alerts:write'],
      enforceReplay: true,
    });

    expect('error' in response).toBe(true);
    if ('error' in response) {
      expect(response.error.status).toBe(409);
    }
  });

  it('accepts valid scoped token when replay check passes', async () => {
    process.env.TRADE_WEBHOOK_SECRET = 'current-secret';

    const now = Math.floor(Date.now() / 1000);
    const token = buildToken({
      iss: 'nexus-service',
      aud: 'nexus-api',
      iat: now,
      exp: now + 300,
      discordUserId: 'discord-1',
      scope: ['alerts:write'],
      jti: 'jti-1',
    }, 'current-secret');

    const request = new Request('http://localhost/test', {
      headers: { Authorization: `Bearer ${token}` },
    });

    const response = await requireServiceClaims(request, buildMockDb({ replayAccepted: true }), {
      requiredScopes: ['alerts:write'],
      enforceReplay: true,
    });

    expect('claims' in response).toBe(true);
    if ('claims' in response) {
      expect(response.claims.discordUserId).toBe('discord-1');
      expect(response.claims.scope).toEqual(['alerts:write']);
    }
  });
});

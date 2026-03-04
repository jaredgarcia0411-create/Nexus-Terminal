import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { hasRequiredScopes, verifyServiceToken, type ServiceTokenClaims } from '@/lib/service-token';

function base64UrlEncode(input: string) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function signToken(claims: Partial<ServiceTokenClaims>, secret: string) {
  const now = Math.floor(Date.now() / 1000);
  const payload: ServiceTokenClaims = {
    iss: 'nexus-service',
    aud: 'nexus-api',
    iat: now,
    exp: now + 300,
    ...claims,
  };

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

const ORIGINAL_ENV = {
  current: process.env.TRADE_WEBHOOK_SECRET,
  previous: process.env.TRADE_WEBHOOK_SECRET_PREVIOUS,
};

afterEach(() => {
  process.env.TRADE_WEBHOOK_SECRET = ORIGINAL_ENV.current;
  process.env.TRADE_WEBHOOK_SECRET_PREVIOUS = ORIGINAL_ENV.previous;
});

describe('service token verification', () => {
  it('accepts valid token signed with current secret', () => {
    process.env.TRADE_WEBHOOK_SECRET = 'current-secret';
    process.env.TRADE_WEBHOOK_SECRET_PREVIOUS = '';

    const token = signToken(
      {
        discordUserId: 'discord-1',
        guildId: 'guild-1',
        scope: ['trades:read'],
        jti: 'token-1',
      },
      'current-secret',
    );

    const claims = verifyServiceToken(token);
    expect(claims).not.toBeNull();
    expect(claims?.discordUserId).toBe('discord-1');
    expect(claims?.scope).toEqual(['trades:read']);
  });

  it('rejects token signed with wrong secret', () => {
    process.env.TRADE_WEBHOOK_SECRET = 'current-secret';
    process.env.TRADE_WEBHOOK_SECRET_PREVIOUS = '';

    const token = signToken({ discordUserId: 'discord-1' }, 'wrong-secret');
    expect(verifyServiceToken(token)).toBeNull();
  });

  it('accepts token signed with previous secret during rotation', () => {
    process.env.TRADE_WEBHOOK_SECRET = 'new-secret';
    process.env.TRADE_WEBHOOK_SECRET_PREVIOUS = 'old-secret';

    const token = signToken({ discordUserId: 'discord-1' }, 'old-secret');
    const claims = verifyServiceToken(token);

    expect(claims).not.toBeNull();
    expect(claims?.discordUserId).toBe('discord-1');
  });

  it('rejects expired token', () => {
    process.env.TRADE_WEBHOOK_SECRET = 'current-secret';
    process.env.TRADE_WEBHOOK_SECRET_PREVIOUS = '';

    const now = Math.floor(Date.now() / 1000);
    const token = signToken(
      {
        iat: now - 600,
        exp: now - 300,
        discordUserId: 'discord-1',
      },
      'current-secret',
    );

    expect(verifyServiceToken(token)).toBeNull();
  });

  it('rejects malformed token payload', () => {
    process.env.TRADE_WEBHOOK_SECRET = 'current-secret';
    process.env.TRADE_WEBHOOK_SECRET_PREVIOUS = '';

    expect(verifyServiceToken('not-a-jwt')).toBeNull();
  });

  it('rejects token with invalid scope claim type', () => {
    process.env.TRADE_WEBHOOK_SECRET = 'current-secret';
    process.env.TRADE_WEBHOOK_SECRET_PREVIOUS = '';

    const token = signToken(
      {
        discordUserId: 'discord-1',
        scope: ['valid', ''],
      },
      'current-secret',
    );

    expect(verifyServiceToken(token)).toBeNull();
  });
});

describe('scope checks', () => {
  it('returns true when all required scopes are present', () => {
    const claims: ServiceTokenClaims = {
      iss: 'nexus-service',
      aud: 'nexus-api',
      iat: 1,
      exp: 2,
      scope: ['trades:read', 'alerts:write'],
    };

    expect(hasRequiredScopes(claims, ['trades:read'])).toBe(true);
    expect(hasRequiredScopes(claims, ['trades:read', 'alerts:write'])).toBe(true);
  });

  it('returns false when a required scope is missing', () => {
    const claims: ServiceTokenClaims = {
      iss: 'nexus-service',
      aud: 'nexus-api',
      iat: 1,
      exp: 2,
      scope: ['trades:read'],
    };

    expect(hasRequiredScopes(claims, ['alerts:write'])).toBe(false);
  });
});

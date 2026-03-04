import { createHmac, timingSafeEqual } from 'node:crypto';

type ServiceTokenHeader = {
  alg: 'HS256';
  typ: 'JWT';
};

export type ServiceTokenClaims = {
  iss: 'nexus-service';
  aud: 'nexus-api';
  iat: number;
  exp: number;
  discordUserId?: string;
  guildId?: string;
  jti?: string;
  scope?: string[];
};

function base64UrlEncode(input: Buffer | string) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(input: string) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(`${normalized}${'='.repeat(padLength)}`, 'base64');
}

function safeJsonParse<T>(payload: string): T | null {
  try {
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
}

function signHmacSha256(payload: string, secret: string) {
  return createHmac('sha256', secret).update(payload).digest();
}

export function getServiceSecrets() {
  const current = process.env.TRADE_WEBHOOK_SECRET?.trim();
  const previous = process.env.TRADE_WEBHOOK_SECRET_PREVIOUS?.trim();
  return [current, previous].filter(Boolean) as string[];
}

export function verifyServiceToken(token: string): ServiceTokenClaims | null {
  const secrets = getServiceSecrets();
  if (secrets.length === 0) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = safeJsonParse<ServiceTokenHeader>(base64UrlDecode(encodedHeader).toString('utf8'));
  const claims = safeJsonParse<ServiceTokenClaims>(base64UrlDecode(encodedPayload).toString('utf8'));
  if (!header || !claims) return null;

  if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;
  if (claims.iss !== 'nexus-service' || claims.aud !== 'nexus-api') return null;
  if (!Number.isFinite(claims.iat) || !Number.isFinite(claims.exp)) return null;
  if (claims.exp <= Math.floor(Date.now() / 1000)) return null;
  if (claims.scope && !Array.isArray(claims.scope)) return null;
  if (claims.scope?.some((value) => typeof value !== 'string' || value.trim().length === 0)) return null;
  if (claims.jti && (typeof claims.jti !== 'string' || claims.jti.trim().length === 0)) return null;

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const tokenSignature = base64UrlDecode(encodedSignature);

  const valid = secrets.some((secret) => {
    const expected = signHmacSha256(signingInput, secret);
    if (expected.length !== tokenSignature.length) return false;
    return timingSafeEqual(expected, tokenSignature);
  });

  return valid ? claims : null;
}

export function hasRequiredScopes(claims: ServiceTokenClaims, requiredScopes: string[]) {
  if (requiredScopes.length === 0) return true;
  const tokenScopes = new Set((claims.scope ?? []).map((scope) => scope.trim()).filter(Boolean));
  return requiredScopes.every((scope) => tokenScopes.has(scope));
}

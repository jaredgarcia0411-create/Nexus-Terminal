import type { Db } from '@/lib/db';
import { consumeServiceTokenJti } from '@/lib/service-token-replay';
import { hasRequiredScopes, type ServiceTokenClaims, verifyServiceToken } from '@/lib/service-token';

type ServiceClaimsOptions = {
  requiredScopes?: string[];
  enforceReplay?: boolean;
};

function readBearerToken(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.slice('Bearer '.length).trim();
}

export async function requireServiceClaims(
  request: Request,
  db: Db,
  options?: ServiceClaimsOptions,
): Promise<{ claims: ServiceTokenClaims } | { error: Response }> {
  const token = readBearerToken(request);
  if (!token) {
    return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const claims = verifyServiceToken(token);
  if (!claims) {
    return { error: Response.json({ error: 'Invalid service token' }, { status: 401 }) };
  }

  const requiredScopes = options?.requiredScopes ?? [];
  if (!hasRequiredScopes(claims, requiredScopes)) {
    return { error: Response.json({ error: 'Insufficient token scope' }, { status: 403 }) };
  }

  if (options?.enforceReplay) {
    const jti = claims.jti?.trim();
    if (!jti) {
      return { error: Response.json({ error: 'Service token missing jti claim' }, { status: 400 }) };
    }
    const consumed = await consumeServiceTokenJti(db, jti, claims.exp);
    if (!consumed) {
      return { error: Response.json({ error: 'Service token replay detected' }, { status: 409 }) };
    }
  }

  return { claims };
}

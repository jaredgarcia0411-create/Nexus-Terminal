import { randomUUID } from 'node:crypto';
import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { schwabLinks } from '@/lib/db/schema';
import { exchangeSchwabCode, getSchwabAuthConfig } from '@/lib/schwab/auth';
import { encryptTokens } from '@/lib/schwab/crypto';
import { dbUnavailable, requireUser } from '@/lib/server-db-utils';

function getCookieValue(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';');
  for (const cookie of cookies) {
    const trimmed = cookie.trim();
    if (!trimmed.startsWith(`${name}=`)) {
      continue;
    }
    return decodeURIComponent(trimmed.slice(name.length + 1));
  }

  return null;
}

function clearStateCookie(response: Response) {
  response.headers.append(
    'Set-Cookie',
    'schwab_oauth_state=; Max-Age=0; Path=/api/schwab/callback; HttpOnly; Secure; SameSite=Lax',
  );
  return response;
}

export async function GET(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    try {
      getSchwabAuthConfig();
    } catch {
      return Response.json({ error: 'Schwab integration not configured' }, { status: 503 });
    }

    const params = new URL(request.url).searchParams;
    const code = params.get('code');
    const state = params.get('state');
    const stateCookie = getCookieValue(request.headers.get('cookie'), 'schwab_oauth_state');

    if (!state || !stateCookie || state !== stateCookie) {
      return clearStateCookie(Response.json({ error: 'Invalid OAuth state - possible CSRF' }, { status: 400 }));
    }

    if (!code) {
      return clearStateCookie(Response.json({ error: 'Missing authorization code' }, { status: 400 }));
    }

    const db = getDb();
    if (!db) return dbUnavailable();

    const tokens = await exchangeSchwabCode(code, state);
    const encrypted = encryptTokens(tokens);

    await db.insert(schwabLinks).values({
      id: randomUUID(),
      userId: authState.user.id,
      encryptedTokens: encrypted.encrypted,
      tokenIv: encrypted.iv,
      tokenTag: encrypted.tag,
      status: 'active',
      accessTokenExpiresAt: new Date(tokens.expiresAt),
      refreshTokenExpiresAt: new Date(tokens.refreshExpiresAt),
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: schwabLinks.userId,
      set: {
        encryptedTokens: encrypted.encrypted,
        tokenIv: encrypted.iv,
        tokenTag: encrypted.tag,
        status: 'active',
        accessTokenExpiresAt: new Date(tokens.expiresAt),
        refreshTokenExpiresAt: new Date(tokens.refreshExpiresAt),
        updatedAt: new Date(),
      },
    });

    const redirectUrl = new URL('/?tab=markets', request.url);
    return clearStateCookie(Response.redirect(redirectUrl));
  } catch (error) {
    logRouteError('schwab.callback.get', error);
    return internalServerError();
  }
}

import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { getSchwabAuthConfig, getSchwabAuthUrl } from '@/lib/schwab/auth';
import { requireUser } from '@/lib/server-db-utils';

export async function GET() {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    try {
      getSchwabAuthConfig();
    } catch {
      return Response.json({ error: 'Schwab integration not configured' }, { status: 503 });
    }

    const { authUrl, state } = await getSchwabAuthUrl();

    // Can't use Response.redirect() because it creates immutable headers,
    // and we need to set a cookie. Build the redirect response manually.
    return new Response(null, {
      status: 302,
      headers: {
        Location: authUrl,
        'Set-Cookie': `schwab_oauth_state=${encodeURIComponent(state)}; Max-Age=600; Path=/api/schwab/callback; HttpOnly; Secure; SameSite=Lax`,
      },
    });
  } catch (error) {
    logRouteError('schwab.auth.get', error);
    return internalServerError();
  }
}

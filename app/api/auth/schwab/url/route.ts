import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth-config';
import { getBaseUrl } from '@/lib/env';
import {
  SCHWAB_OAUTH_STATE_COOKIE,
  SCHWAB_OAUTH_STATE_TTL_SECONDS,
  generateSchwabOAuthState,
} from '@/lib/schwab-oauth-state';

export async function GET() {
  const session = await auth();
  const user = session?.user as ({ id?: string; email?: string | null } | undefined);
  if (!user?.id || !user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const clientId = process.env.SCHWAB_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: 'Schwab integration not configured' }, { status: 500 });
  }

  const state = generateSchwabOAuthState();
  const redirectUri = `${getBaseUrl()}/api/auth/schwab/callback`;
  const oauthBase = process.env.SCHWAB_OAUTH_BASE_URL || 'https://api.schwab.com';

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'readonly',
    state,
  });

  const url = `${oauthBase.replace(/\/$/, '')}/v1/oauth/authorize?${params.toString()}`;

  const response = NextResponse.json({ url });
  response.cookies.set({
    name: SCHWAB_OAUTH_STATE_COOKIE,
    value: state,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SCHWAB_OAUTH_STATE_TTL_SECONDS,
  });

  return response;
}

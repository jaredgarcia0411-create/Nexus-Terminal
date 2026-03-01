import { NextResponse } from 'next/server';
import { getBaseUrl } from '@/lib/env';

export async function GET() {
  const clientId = process.env.SCHWAB_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: 'Schwab integration not configured' }, { status: 500 });
  }

  const redirectUri = `${getBaseUrl()}/api/auth/schwab/callback`;
  const oauthBase = process.env.SCHWAB_OAUTH_BASE_URL || 'https://api.schwab.com';

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'readonly',
  });

  const url = `${oauthBase.replace(/\/$/, '')}/v1/oauth/authorize?${params.toString()}`;

  return NextResponse.json({ url });
}

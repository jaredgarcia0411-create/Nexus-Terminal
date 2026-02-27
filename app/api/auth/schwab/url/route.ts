import { NextResponse } from 'next/server';

export async function GET() {
  const clientId = process.env.SCHWAB_CLIENT_ID;
  const redirectUri = `${process.env.APP_URL}/api/auth/schwab/callback`;
  
  // Schwab OAuth 2.0 URL
  const params = new URLSearchParams({
    client_id: clientId!,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'readonly', // Adjust scope as needed for backtesting data
  });

  const url = `https://api.schwab.com/v1/oauth/authorize?${params.toString()}`;
  
  return NextResponse.json({ url });
}

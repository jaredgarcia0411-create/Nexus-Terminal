import { NextResponse } from 'next/server';
import axios from 'axios';
import { getBaseUrl } from '@/lib/env';
import { setSchwabTokens } from '@/lib/auth';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');

  if (!code) {
    return NextResponse.json({ error: 'No code provided' }, { status: 400 });
  }

  try {
    const tokenResponse = await axios.post('https://api.schwab.com/v1/oauth/token', {
      code,
      client_id: process.env.SCHWAB_CLIENT_ID,
      client_secret: process.env.SCHWAB_CLIENT_SECRET,
      redirect_uri: `${getBaseUrl()}/api/auth/schwab/callback`,
      grant_type: 'authorization_code',
    });

    const { access_token, refresh_token } = tokenResponse.data;
    await setSchwabTokens(access_token, refresh_token);

    return new NextResponse(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'SCHWAB_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Charles Schwab connected successfully. This window should close automatically.</p>
        </body>
      </html>
    `, {
      headers: { 'Content-Type': 'text/html' },
    });
  } catch (err: any) {
    console.error('Schwab OAuth error:', err.response?.data || err.message);
    return NextResponse.json({ error: 'Schwab connection failed' }, { status: 500 });
  }
}

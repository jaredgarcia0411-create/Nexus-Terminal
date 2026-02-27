import { NextResponse } from 'next/server';
import axios from 'axios';

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
      redirect_uri: `${process.env.APP_URL}/api/auth/schwab/callback`,
      grant_type: 'authorization_code',
    });

    const { access_token, refresh_token } = tokenResponse.data;

    // Store Schwab tokens in a secure way (e.g., database associated with user)
    // For now, we'll just send a success message to the parent window
    // In a real app, you'd associate these tokens with the logged-in user session.

    return new NextResponse(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'SCHWAB_AUTH_SUCCESS', tokens: { access_token: '${access_token}' } }, '*');
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

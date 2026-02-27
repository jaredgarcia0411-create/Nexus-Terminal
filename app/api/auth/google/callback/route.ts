import { NextResponse } from 'next/server';
import axios from 'axios';
import { createSession } from '@/lib/auth';
import { getBaseUrl } from '@/lib/env';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');

  if (!code) {
    return NextResponse.json({ error: 'No code provided' }, { status: 400 });
  }

  try {
    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${getBaseUrl()}/api/auth/google/callback`,
      grant_type: 'authorization_code',
    });

    const { access_token } = tokenResponse.data;

    const userResponse = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const user = {
      id: userResponse.data.sub,
      email: userResponse.data.email,
      name: userResponse.data.name,
      picture: userResponse.data.picture,
    };

    await createSession(user);

    return new NextResponse(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `, {
      headers: { 'Content-Type': 'text/html' },
    });
  } catch (err: any) {
    console.error('Google OAuth error:', err.response?.data || err.message);
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
  }
}

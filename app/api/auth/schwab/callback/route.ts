import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getBaseUrl } from '@/lib/env';
import { auth } from '@/lib/auth-config';
import { getDb, type Db } from '@/lib/db';
import { schwabTokens } from '@/lib/db/schema';
import { ensureUser } from '@/lib/server-db-utils';
import { SCHWAB_OAUTH_STATE_COOKIE, statesMatch } from '@/lib/schwab-oauth-state';

function clearOAuthStateCookie(response: NextResponse) {
  response.cookies.set({
    name: SCHWAB_OAUTH_STATE_COOKIE,
    value: '',
    path: '/',
    maxAge: 0,
  });
  return response;
}

export async function GET(request: Request) {
  const session = await auth();
  const user = session?.user as ({ id?: string; email?: string | null; name?: string | null; image?: string | null } | undefined);
  if (!user?.id || !user.email) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  const db: Db | null = getDb();
  if (!db) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  await ensureUser(db, {
    id: user.id,
    email: user.email,
    name: user.name ?? null,
    picture: user.image ?? null,
  });

  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(SCHWAB_OAUTH_STATE_COOKIE)?.value;

  if (!statesMatch(expectedState, state)) {
    return clearOAuthStateCookie(NextResponse.json({ error: 'Invalid OAuth state' }, { status: 400 }));
  }

  if (!code) {
    return clearOAuthStateCookie(NextResponse.json({ error: 'No code provided' }, { status: 400 }));
  }

  try {
    const tokenResponse = await fetch('https://api.schwab.com/v1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        client_id: process.env.SCHWAB_CLIENT_ID,
        client_secret: process.env.SCHWAB_CLIENT_SECRET,
        redirect_uri: `${getBaseUrl()}/api/auth/schwab/callback`,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const detail = await tokenResponse.text();
      console.error('Schwab OAuth error response:', detail);
      return clearOAuthStateCookie(NextResponse.json({ error: 'Schwab connection failed' }, { status: 500 }));
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in?: number;
    };

    const expiresAt = new Date(Date.now() + (tokenData.expires_in ?? 3600) * 1000).toISOString();

    await db.insert(schwabTokens).values({
      userId: user.id,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: schwabTokens.userId,
      set: {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt,
        updatedAt: new Date(),
      },
    });

  const baseUrl = getBaseUrl();
  const response = new NextResponse(
    `
<html>
<body>
<script>
if (window.opener) {
  window.opener.postMessage({ type: 'SCHWAB_AUTH_SUCCESS' }, '${baseUrl}');
  window.close();
} else {
  window.location.href = '/';
}
</script>
<p>Charles Schwab connected successfully. This window should close automatically.</p>
</body>
</html>
`,
      {
        headers: { 'Content-Type': 'text/html' },
      },
    );
    return clearOAuthStateCookie(response);
  } catch (err) {
    console.error('Schwab OAuth error:', err);
    return clearOAuthStateCookie(NextResponse.json({ error: 'Schwab connection failed' }, { status: 500 }));
  }
}

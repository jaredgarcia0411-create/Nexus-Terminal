import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'default-secret-key-change-me');
const isProduction = process.env.NODE_ENV === 'production';

const getCookieOptions = () => ({
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'none' as const : 'lax' as const,
  path: '/',
});

export async function createSession(user: any) {
  const token = await new SignJWT(user)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(SECRET);

  const cookieStore = await cookies();
  cookieStore.set('session', token, getCookieOptions());
}

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session')?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload;
  } catch (err) {
    return null;
  }
}

export async function deleteSession() {
  const cookieStore = await cookies();
  cookieStore.delete('session');
}

export async function setSchwabTokens(accessToken: string, refreshToken?: string) {
  const cookieStore = await cookies();
  cookieStore.set('schwab_access_token', accessToken, getCookieOptions());
  if (refreshToken) {
    cookieStore.set('schwab_refresh_token', refreshToken, getCookieOptions());
  }
}

export async function getSchwabTokens() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get('schwab_access_token')?.value;
  const refreshToken = cookieStore.get('schwab_refresh_token')?.value;

  if (!accessToken) return null;

  return {
    accessToken,
    refreshToken: refreshToken || null,
  };
}

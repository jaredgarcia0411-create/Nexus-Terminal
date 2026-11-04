import NextAuth, { type NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';

import { isEmailAllowed } from '@/lib/auth-allowlist';

const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
const missingGoogleConfig = !googleClientId || !googleClientSecret;

if (missingGoogleConfig) {
  const message = 'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET before enabling sign in.';

  if (process.env.NODE_ENV !== 'test') {
    console.warn(`[auth-config] ${message}`);
  }
}

const config: NextAuthConfig = {
  providers: [
    ...(missingGoogleConfig
      ? []
      : [
          Google({
            clientId: googleClientId,
            clientSecret: googleClientSecret,
            authorization: { params: { prompt: 'select_account' } },
          }),
        ]),
  ],
  session: { strategy: 'jwt' },
  callbacks: {
    signIn({ user }) {
      // Fail closed: if the allowlist is missing or empty, deny everyone
      // rather than letting any Google account sign in.
      return isEmailAllowed(user.email);
    },
    authorized({ auth, request: { nextUrl } }) {
      // Sessions are JWTs that outlive an allowlist edit, so a removed user
      // still carries a valid cookie. Re-check the allowlist on every page
      // request; API routes do the same inside requireUser().
      const isLoggedIn = !!auth?.user && isEmailAllowed(auth.user.email);
      const isLoginPage = nextUrl.pathname === '/login';

      if (isLoginPage) {
        if (isLoggedIn) {
          return Response.redirect(new URL('/', nextUrl));
        }
        return true;
      }

      return isLoggedIn;
    },
    jwt({ token, user }) {
      if (user) {
        (token as { id?: string; picture?: string | null }).id = user.id;
        (token as { id?: string; picture?: string | null }).picture = user.image;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string; image?: string | null }).id = (token as { id?: string }).id;
        (session.user as { id?: string; image?: string | null }).image = (token as { picture?: string | null }).picture;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(config);

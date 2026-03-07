import NextAuth, { type NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';

const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
const missingGoogleConfig = !googleClientId || !googleClientSecret;

if (missingGoogleConfig) {
  const message = 'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET before enabling sign in.';

  if (process.env.NODE_ENV !== 'test') {
    throw new Error(message);
  }

  console.warn(`[auth-config] ${message}`);
}

const config: NextAuthConfig = {
  providers: [
    ...(missingGoogleConfig
      ? []
      : [
          Google({
            clientId: googleClientId,
            clientSecret: googleClientSecret,
          }),
        ]),
  ],
  session: { strategy: 'jwt' },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
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

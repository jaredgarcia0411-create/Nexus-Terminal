import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { userCredentials, users } from '@/lib/db/schema';
import { verifyPassword } from '@/lib/password';

const USER_ID_PATTERN = /^[a-z0-9._-]{3,32}$/;

const config: NextAuthConfig = {
  providers: [
    Credentials({
      name: 'Credentials',
      credentials: {
        userId: { label: 'User ID', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const userId = String(credentials?.userId ?? '').trim().toLowerCase();
        const password = String(credentials?.password ?? '');
        if (!USER_ID_PATTERN.test(userId) || password.length < 8) return null;

        const db = getDb();
        if (!db) return null;

        const rows = await db.select({
          id: users.id,
          email: users.email,
          name: users.name,
          picture: users.picture,
          passwordHash: userCredentials.passwordHash,
        }).from(userCredentials)
          .innerJoin(users, eq(users.id, userCredentials.userId))
          .where(eq(userCredentials.loginId, userId))
          .limit(1);

        const row = rows[0];
        if (!row) return null;

        const valid = await verifyPassword(password, row.passwordHash);
        if (!valid) return null;

        return {
          id: row.id,
          email: row.email,
          name: row.name,
          image: row.picture,
        };
      },
    }),
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

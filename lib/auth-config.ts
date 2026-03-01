import NextAuth, { type NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';

const config: NextAuthConfig = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  session: { strategy: 'jwt' },
  callbacks: {
    signIn({ user }) {
      const allowed = process.env.ALLOWED_EMAILS;
      if (!allowed) return true;
      const emails = allowed
        .split(',')
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean);
      return emails.includes((user.email ?? '').toLowerCase());
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

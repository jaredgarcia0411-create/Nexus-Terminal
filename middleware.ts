export { auth as middleware } from '@/lib/auth-config';

export const config = {
  matcher: ['/((?!api|login|_next/static|_next/image|favicon.ico).*)'],
};

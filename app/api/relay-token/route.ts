import { createHmac } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { getDb } from '@/lib/db';
import { schwabLinks } from '@/lib/db/schema';
import { requireUser } from '@/lib/server-db-utils';

export const dynamic = 'force-dynamic';

/**
 * GET /api/relay-token
 *
 * Returns a short-lived JWT for connecting to the Schwab relay WebSocket.
 * The token expires in 60 seconds — it's only used for the handshake.
 *
 * Requires:
 * - Authenticated user (NextAuth session)
 * - Active Schwab link (schwab_links table)
 * - RELAY_WS_SECRET and RELAY_WS_URL env vars
 */
export async function GET() {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const secret = process.env.RELAY_WS_SECRET;
  const wsUrl = process.env.RELAY_WS_URL;

  if (!secret || !wsUrl) {
    return Response.json(
      { error: 'Relay WebSocket not configured' },
      { status: 503 },
    );
  }

  const db = getDb();
  if (!db) {
    return Response.json({ error: 'Database unavailable' }, { status: 503 });
  }

  const [link] = await db
    .select({ status: schwabLinks.status, refreshTokenExpiresAt: schwabLinks.refreshTokenExpiresAt })
    .from(schwabLinks)
    .where(eq(schwabLinks.userId, authState.user.id))
    .limit(1);

  if (!link || link.status !== 'active' || link.refreshTokenExpiresAt.getTime() < Date.now()) {
    return Response.json(
      { error: 'No active Schwab link. Connect your Schwab account first.' },
      { status: 400 },
    );
  }

  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: authState.user.id,
      exp: Math.floor(Date.now() / 1000) + 60,
    }),
  ).toString('base64url');

  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  const token = `${header}.${payload}.${signature}`;

  return Response.json({ token, wsUrl });
}

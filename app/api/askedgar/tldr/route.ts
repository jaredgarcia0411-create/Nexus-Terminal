import { z } from 'zod';

import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { getCachedResearchTldr } from '@/lib/research';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const tldrSchema = z.object({
  ticker: z.string().trim().toUpperCase().regex(/^[A-Z0-9.\-^]{1,10}$/, 'Valid ticker required'),
});

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();

    const bodyState = await parseAndValidate(request, tldrSchema);
    if (bodyState.error) return bodyState.error;
    const { ticker } = bodyState.data;

    const rate = await checkRateLimit(db, authState.user.id, 'askedgar-tldr');
    if (rate.limited) return rateLimitResponse(rate);

    const user = await ensureUser(db, authState.user);
    const result = await getCachedResearchTldr(ticker, user.id);

    return Response.json({
      ticker,
      ...result,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    logRouteError('askedgar-tldr', error);
    return internalServerError();
  }
}

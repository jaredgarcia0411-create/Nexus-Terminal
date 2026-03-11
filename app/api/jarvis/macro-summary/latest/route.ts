import { desc } from 'drizzle-orm';
import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { macroSummaries } from '@/lib/db/schema';
import { requireUser } from '@/lib/server-db-utils';

export async function GET() {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) {
      return Response.json({ latest: null });
    }

    const [latest] = await db
      .select({ summaryJson: macroSummaries.summaryJson })
      .from(macroSummaries)
      .orderBy(desc(macroSummaries.generatedAt))
      .limit(1);

    return Response.json({ latest: (latest?.summaryJson as unknown) ?? null });
  } catch (error) {
    logRouteError('jarvis.macro-summary.latest.get', error);
    return internalServerError();
  }
}

import { z } from 'zod';

import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getCachedTickerData } from '@/lib/askedgar';
import { runResearchTldr } from '@/lib/research';
import { requireUser } from '@/lib/server-db-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const tldrSchema = z.object({
  ticker: z.string().trim().toUpperCase().regex(/^[A-Z0-9.\-^]{1,10}$/, 'Valid ticker required'),
});

export async function POST(request: Request) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const bodyState = await parseAndValidate(request, tldrSchema);
  if (bodyState.error) return bodyState.error;
  const { ticker } = bodyState.data;

  try {
    const askEdgarData = await getCachedTickerData(ticker);
    const result = await runResearchTldr(askEdgarData.rawData, ticker);

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

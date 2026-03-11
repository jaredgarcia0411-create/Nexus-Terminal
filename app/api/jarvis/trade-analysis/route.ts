import { internalServerError, logRouteError, parseJsonBody } from '@/lib/api-route-utils';
import { requireUser } from '@/lib/server-db-utils';
import { runTradeAnalysisPipeline } from '@/lib/jarvis/trade-analysis';

interface TradeAnalysisBody {
  days?: number;
}

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const bodyState = await parseJsonBody<TradeAnalysisBody>(request);
    if (bodyState.error) return bodyState.error;

    const result = await runTradeAnalysisPipeline(authState.user.id, bodyState.data.days);
    return Response.json(result.analysis);
  } catch (error) {
    logRouteError('jarvis.trade-analysis.post', error);
    return internalServerError();
  }
}

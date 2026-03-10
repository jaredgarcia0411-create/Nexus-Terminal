import { desc, eq } from 'drizzle-orm';
import { internalServerError, logRouteError, parseJsonBody } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { trades } from '@/lib/db/schema';
import { requireUser } from '@/lib/server-db-utils';
import { callJarvis } from '@/lib/jarvis/client';
import { buildContext } from '@/lib/jarvis/context';
import { extractTradeInsights } from '@/lib/jarvis/memory';
import { JARVIS_SYSTEM_PROMPT, buildTradeAnalysisPrompt } from '@/lib/jarvis/prompts';
import { normalizeTradeAnalysisPayload } from '@/lib/jarvis/trade-analysis';

interface TradeAnalysisBody {
  days?: number;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export async function runTradeAnalysisPipeline(userId: string, days = 30) {
  const db = getDb();
  if (!db) {
    throw new Error('Database not configured');
  }

  const requestedDays = Number.isFinite(days) && days > 0 ? Math.floor(days) : 30;
  const maxRows = Math.min(800, requestedDays * 40);
  await db.select({ id: trades.id })
    .from(trades)
    .where(eq(trades.userId, userId))
    .orderBy(desc(trades.createdAt))
    .limit(maxRows);

  const context = await buildContext(userId, 'trade-analysis');
  const prompt = buildTradeAnalysisPrompt(context);
  const llm = await callJarvis(JARVIS_SYSTEM_PROMPT, prompt);
  const normalized = normalizeTradeAnalysisPayload(parseJson(llm.content));

  await extractTradeInsights(userId, normalized);

  return {
    analysis: normalized,
    modelUsed: llm.modelUsed,
  };
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

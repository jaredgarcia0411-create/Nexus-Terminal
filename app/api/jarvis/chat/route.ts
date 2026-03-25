import { and, eq } from 'drizzle-orm';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { jarvisConversations } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { callJarvis } from '@/lib/jarvis/client';
import { parseResearchCommand, saveConversation } from '@/lib/jarvis/chat-helpers';
import { buildContext } from '@/lib/jarvis/context';
import { JARVIS_SYSTEM_PROMPT, buildChatPrompt } from '@/lib/jarvis/prompts';
import { checkRateLimit, rateLimitExceededResponse } from '@/lib/jarvis/rate-limit';
import { fetchAndCacheRawReport, runResearchTldr } from '@/lib/jarvis/research';
import { estimateTokens, logJarvisRequest } from '@/lib/jarvis/token-tracking';
import { runTradeAnalysisPipeline } from '@/lib/jarvis/trade-analysis';
import { jarvisChatSchema } from '@/lib/validations/jarvis';

export async function POST(request: Request) {
  const startedAt = Date.now();
  let userId: string | null = null;
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    const canonicalUser = await ensureUser(db, authState.user);
    userId = canonicalUser.id;

    const rateLimitResult = await checkRateLimit(userId);
    if (!rateLimitResult.allowed) return rateLimitExceededResponse(rateLimitResult);

    const bodyState = await parseAndValidate(request, jarvisChatSchema);
    if (bodyState.error) return bodyState.error;

    const message = bodyState.data.message;
    const sessionId = bodyState.data.session_id || crypto.randomUUID();
    const context = await buildContext(userId);

    const [firstMessage] = await db.select({ id: jarvisConversations.id })
      .from(jarvisConversations)
      .where(and(eq(jarvisConversations.userId, userId), eq(jarvisConversations.sessionId, sessionId)))
      .limit(1);

    await saveConversation({
      db,
      userId,
      sessionId,
      role: 'user',
      content: message,
      mode: 'chat',
      contextSnapshot: firstMessage ? null : context,
    });

    const researchCommand = parseResearchCommand(message);
    if (researchCommand) {
      if (!researchCommand.ticker) {
        return Response.json({ error: 'ticker is required' }, { status: 400 });
      }

      const rawResult = await fetchAndCacheRawReport(userId, researchCommand.ticker);
      const tldr = await runResearchTldr(rawResult.rawData, rawResult.ticker);
      const responseText = `Research TLDR for ${rawResult.ticker}`;
      await saveConversation({ db, userId, sessionId, role: 'assistant', content: responseText, mode: 'research' });
      return Response.json({
        message: responseText,
        session_id: sessionId,
        researchTldr: tldr,
        warnings: rawResult.warnings,
        fromCache: rawResult.fromCache,
      });
    }

    if (message.trim() === '/analyze') {
      const result = await runTradeAnalysisPipeline(userId);
      const responseText = 'Trade analysis completed.';
      await saveConversation({ db, userId, sessionId, role: 'assistant', content: responseText, mode: 'trade-analysis' });
      return Response.json({ message: responseText, session_id: sessionId, tradeAnalysis: result.analysis });
    }

    const prompt = buildChatPrompt(context, message);
    const llm = await callJarvis(JARVIS_SYSTEM_PROMPT, prompt);
    await saveConversation({ db, userId, sessionId, role: 'assistant', content: llm.content, mode: 'chat' });

    try {
      await logJarvisRequest({
        userId,
        mode: 'chat',
        inputTokens: estimateTokens(prompt),
        outputTokens: estimateTokens(llm.content),
        durationMs: Date.now() - startedAt,
        success: true,
        sourceCount: 0,
        chunkCount: 0,
      });
    } catch (logError) {
      logRouteError('jarvis.chat.post.token-tracking', logError);
    }

    return Response.json({ message: llm.content, session_id: sessionId });
  } catch (error) {
    if (userId) {
      try {
        await logJarvisRequest({
          userId,
          mode: 'chat',
          inputTokens: 0,
          outputTokens: 0,
          durationMs: Date.now() - startedAt,
          success: false,
          sourceCount: 0,
          chunkCount: 0,
        });
      } catch (logError) {
        logRouteError('jarvis.chat.post.token-tracking', logError);
      }
    }
    logRouteError('jarvis.chat.post', error);
    return internalServerError();
  }
}

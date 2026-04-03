import { and, eq } from 'drizzle-orm';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { jarvisConversations } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { callJarvis, callJarvisStreaming } from '@/lib/jarvis/client';
import { parseResearchCommand, saveConversation } from '@/lib/jarvis/chat-helpers';
import { buildContext } from '@/lib/jarvis/context';
import { JARVIS_SYSTEM_PROMPT, buildChatPrompt } from '@/lib/jarvis/prompts';
import { checkRateLimit, rateLimitExceededResponse } from '@/lib/jarvis/rate-limit';
import { fetchAndCacheRawReport, runResearchTldr } from '@/lib/jarvis/research';
import { logJarvisRequest } from '@/lib/jarvis/token-tracking';
import { runTradeAnalysisPipeline } from '@/lib/jarvis/trade-analysis';
import { createSSEResponse } from '@/lib/sse';
import { jarvisChatSchema } from '@/lib/validations/jarvis';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request) {
  const startedAt = Date.now();
  let userId: string | null = null;
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    const canonicalUser = await ensureUser(db, authState.user);
    const canonicalUserId = canonicalUser.id;
    userId = canonicalUserId;

    const rateLimitResult = await checkRateLimit(canonicalUserId);
    if (!rateLimitResult.allowed) return rateLimitExceededResponse(rateLimitResult);

    const bodyState = await parseAndValidate(request, jarvisChatSchema);
    if (bodyState.error) return bodyState.error;

    const url = new URL(request.url);
    const isStream = url.searchParams.get('stream') === '1';
    const message = bodyState.data.message;
    const researchCommand = parseResearchCommand(message);
    const isAnalyzeCommand = message.trim() === '/analyze';

    if (isStream && (researchCommand || isAnalyzeCommand)) {
      return Response.json({ redirect: true });
    }

    const sessionId = bodyState.data.session_id || crypto.randomUUID();
    const context = await buildContext(canonicalUserId);

    const [firstMessage] = await db.select({ id: jarvisConversations.id })
      .from(jarvisConversations)
      .where(and(eq(jarvisConversations.userId, canonicalUserId), eq(jarvisConversations.sessionId, sessionId)))
      .limit(1);

    await saveConversation({
      db,
      userId: canonicalUserId,
      sessionId,
      role: 'user',
      content: message,
      mode: 'chat',
      contextSnapshot: firstMessage ? null : context,
    });

    if (researchCommand) {
      if (!researchCommand.ticker) {
        return Response.json({ error: 'ticker is required' }, { status: 400 });
      }

      const rawResult = await fetchAndCacheRawReport(canonicalUserId, researchCommand.ticker);
      const tldr = await runResearchTldr(rawResult.rawData, rawResult.ticker);
      const responseText = `Research TLDR for ${rawResult.ticker}`;
      await saveConversation({ db, userId: canonicalUserId, sessionId, role: 'assistant', content: responseText, mode: 'research' });
      return Response.json({
        message: responseText,
        session_id: sessionId,
        researchTldr: tldr,
        warnings: rawResult.warnings,
        fromCache: rawResult.fromCache,
      });
    }

    if (isAnalyzeCommand) {
      const result = await runTradeAnalysisPipeline(canonicalUserId);
      const responseText = 'Trade analysis completed.';
      await saveConversation({ db, userId: canonicalUserId, sessionId, role: 'assistant', content: responseText, mode: 'trade-analysis' });
      return Response.json({ message: responseText, session_id: sessionId, tradeAnalysis: result.analysis });
    }

    if (isStream) {
      const prompt = buildChatPrompt(context, message);
      try {
        const { stream } = await callJarvisStreaming(JARVIS_SYSTEM_PROMPT, prompt);
        const reader = stream.getReader();

        return createSSEResponse(request.signal, (send) => {
          let fullText = '';
          let closed = false;

          const closeReader = () => {
            if (closed) return;
            closed = true;
            reader.cancel().catch(() => {});
          };

          void (async () => {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                fullText += value;
                send('token', { text: value });
              }

              send('done', { fullText, session_id: sessionId });

              await Promise.all([
                saveConversation({ db, userId: canonicalUserId, sessionId, role: 'assistant', content: fullText, mode: 'chat' }),
                logJarvisRequest({ userId: canonicalUserId, mode: 'chat', durationMs: Date.now() - startedAt, success: true }),
              ]);
            } catch {
              send('error', { message: 'Stream interrupted' });
              await logJarvisRequest({ userId: canonicalUserId, mode: 'chat', durationMs: Date.now() - startedAt, success: false });
            }
          })();

          return () => {
            closeReader();
          };
        });
      } catch {
        await logJarvisRequest({ userId: canonicalUserId, mode: 'chat', durationMs: Date.now() - startedAt, success: false });
        return Response.json({ error: 'Failed to start stream' }, { status: 500 });
      }
    }

    const prompt = buildChatPrompt(context, message);
    const llm = await callJarvis(JARVIS_SYSTEM_PROMPT, prompt);
    await saveConversation({ db, userId: canonicalUserId, sessionId, role: 'assistant', content: llm.content, mode: 'chat' });

    await logJarvisRequest({ userId: canonicalUserId, mode: 'chat', durationMs: Date.now() - startedAt, success: true });

    return Response.json({ message: llm.content, session_id: sessionId });
  } catch (error) {
    if (userId) {
      await logJarvisRequest({ userId, mode: 'chat', durationMs: Date.now() - startedAt, success: false });
    }
    logRouteError('jarvis.chat.post', error);
    return internalServerError();
  }
}

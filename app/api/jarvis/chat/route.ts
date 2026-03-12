import { and, eq } from 'drizzle-orm';
import { internalServerError, logRouteError, parseJsonBody } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { jarvisConversations } from '@/lib/db/schema';
import { ensureUser, requireUser } from '@/lib/server-db-utils';
import { callJarvis } from '@/lib/jarvis/client';
import { buildContext } from '@/lib/jarvis/context';
import { JARVIS_SYSTEM_PROMPT, buildChatPrompt } from '@/lib/jarvis/prompts';
import { checkRateLimit } from '@/lib/jarvis/rate-limit';
import { runResearchPipeline } from '@/lib/jarvis/research';
import { estimateInputTokens, estimateOutputTokens, logJarvisRequest } from '@/lib/jarvis/token-tracking';
import { runTradeAnalysisPipeline } from '@/lib/jarvis/trade-analysis';
import type { JarvisMode } from '@/lib/jarvis/types';

interface ChatBody {
  message?: string;
  session_id?: string;
}

async function saveConversation(input: {
  userId: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  mode: JarvisMode;
  contextSnapshot?: unknown;
}) {
  const db = getDb();
  if (!db) return;

  await db.insert(jarvisConversations).values({
    id: crypto.randomUUID(),
    userId: input.userId,
    sessionId: input.sessionId,
    role: input.role,
    content: input.content,
    mode: input.mode,
    contextSnapshot: input.contextSnapshot ?? null,
    createdAt: new Date(),
  });
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  let userId: string | null = null;
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;
    userId = authState.user.id;

    const db = getDb();
    if (db) {
      await ensureUser(db, authState.user);
    }

    const rateLimitResult = checkRateLimit(userId);
    if (!rateLimitResult.allowed) {
      return Response.json(
        { error: 'Rate limit exceeded. Try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000)) },
        },
      );
    }

    const bodyState = await parseJsonBody<ChatBody>(request);
    if (bodyState.error) return bodyState.error;

    const message = bodyState.data.message?.trim() ?? '';
    if (!message) {
      return Response.json({ error: 'message is required' }, { status: 400 });
    }

    const sessionId = bodyState.data.session_id?.trim() || crypto.randomUUID();
    const context = await buildContext(userId, 'chat');

    const [firstMessage] = await (db?.select({ id: jarvisConversations.id })
      .from(jarvisConversations)
      .where(and(eq(jarvisConversations.userId, userId), eq(jarvisConversations.sessionId, sessionId)))
      .limit(1) ?? Promise.resolve([]));

    await saveConversation({
      userId,
      sessionId,
      role: 'user',
      content: message,
      mode: 'chat',
      contextSnapshot: firstMessage ? null : context,
    });

    if (message.startsWith('/research ')) {
      const ticker = message.slice('/research '.length).trim().toUpperCase();
      const result = await runResearchPipeline(userId, ticker);
      const responseText = `Research report generated for ${result.ticker}.`;
      await saveConversation({ userId, sessionId, role: 'assistant', content: responseText, mode: 'research' });
      return Response.json({ message: responseText, session_id: sessionId, reportJson: result.report });
    }

    if (message.trim() === '/analyze') {
      const result = await runTradeAnalysisPipeline(userId, 30);
      const responseText = 'Trade analysis completed.';
      await saveConversation({ userId, sessionId, role: 'assistant', content: responseText, mode: 'trade-analysis' });
      return Response.json({ message: responseText, session_id: sessionId, tradeAnalysis: result.analysis });
    }

    const prompt = buildChatPrompt(context, message);
    const llm = await callJarvis(JARVIS_SYSTEM_PROMPT, prompt);
    await saveConversation({ userId, sessionId, role: 'assistant', content: llm.content, mode: 'chat' });

    await logJarvisRequest({
      userId,
      mode: 'chat',
      inputTokens: estimateInputTokens(prompt),
      outputTokens: estimateOutputTokens(llm.content),
      durationMs: Date.now() - startedAt,
      success: true,
      sourceCount: 0,
      chunkCount: 0,
    });

    return Response.json({ message: llm.content, session_id: sessionId });
  } catch (error) {
    if (userId) {
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
    }
    logRouteError('jarvis.chat.post', error);
    return internalServerError();
  }
}

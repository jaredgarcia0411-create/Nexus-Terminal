import { and, eq } from 'drizzle-orm';
import { parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { jarvisConversations } from '@/lib/db/schema';
import { callJarvisStreaming } from '@/lib/jarvis/client';
import { parseResearchCommand, saveConversation } from '@/lib/jarvis/chat-helpers';
import { buildContext } from '@/lib/jarvis/context';
import { JARVIS_SYSTEM_PROMPT, buildChatPrompt } from '@/lib/jarvis/prompts';
import { checkRateLimit, rateLimitExceededResponse } from '@/lib/jarvis/rate-limit';
import { logJarvisRequest } from '@/lib/jarvis/token-tracking';
import { createSSEResponse } from '@/lib/sse';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { jarvisChatSchema } from '@/lib/validations/jarvis';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request) {
  const startedAt = Date.now();

  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return dbUnavailable();

  const canonicalUser = await ensureUser(db, authState.user);
  const userId = canonicalUser.id;

  const rateLimitResult = await checkRateLimit(userId);
  if (!rateLimitResult.allowed) return rateLimitExceededResponse(rateLimitResult);

  const bodyState = await parseAndValidate(request, jarvisChatSchema);
  if (bodyState.error) return bodyState.error;

  const message = bodyState.data.message;

  if (parseResearchCommand(message) || message.trim() === '/analyze') {
    return Response.json({ redirect: true });
  }

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
            saveConversation({
              db,
              userId,
              sessionId,
              role: 'assistant',
              content: fullText,
              mode: 'chat',
            }),
            logJarvisRequest({ userId, mode: 'chat', durationMs: Date.now() - startedAt, success: true }),
          ]);
        } catch {
          send('error', { message: 'Stream interrupted' });
          await logJarvisRequest({ userId, mode: 'chat', durationMs: Date.now() - startedAt, success: false });
        }
      })();

      return () => {
        closeReader();
      };
    });
  } catch {
    await logJarvisRequest({ userId, mode: 'chat', durationMs: Date.now() - startedAt, success: false });
    return Response.json({ error: 'Failed to start stream' }, { status: 500 });
  }
}

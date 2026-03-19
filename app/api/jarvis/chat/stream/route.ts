import { and, eq } from 'drizzle-orm';
import { parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { jarvisConversations } from '@/lib/db/schema';
import { callJarvisStreaming } from '@/lib/jarvis/client';
import { buildContext } from '@/lib/jarvis/context';
import { JARVIS_SYSTEM_PROMPT, buildChatPrompt } from '@/lib/jarvis/prompts';
import { checkRateLimit } from '@/lib/jarvis/rate-limit';
import { estimateInputTokens, estimateOutputTokens, logJarvisRequest } from '@/lib/jarvis/token-tracking';
import type { JarvisMode } from '@/lib/jarvis/types';
import { createSSEResponse } from '@/lib/sse';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { jarvisChatSchema } from '@/lib/validations/jarvis';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface ResearchCommand {
  ticker: string;
}

function parseResearchCommand(message: string): ResearchCommand | null {
  const trimmed = message.trim();
  if (trimmed === '/research') {
    return { ticker: '' };
  }

  if (!trimmed.startsWith('/research ')) {
    return null;
  }

  const remainder = trimmed.slice('/research '.length).trim();
  if (!remainder) {
    return { ticker: '' };
  }

  return {
    ticker: (remainder.split(/\s+/)[0] ?? '').toUpperCase(),
  };
}

async function saveConversation(input: {
  db: NonNullable<ReturnType<typeof getDb>>;
  userId: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  mode: JarvisMode;
  contextSnapshot?: unknown;
}) {
  await input.db.insert(jarvisConversations).values({
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

  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return dbUnavailable();

  const canonicalUser = await ensureUser(db, authState.user);
  const userId = canonicalUser.id;

  const rateLimitResult = await checkRateLimit(userId);
  if (!rateLimitResult.allowed) {
    return Response.json(
      { error: 'Rate limit exceeded. Try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000)) },
      },
    );
  }

  const bodyState = await parseAndValidate(request, jarvisChatSchema);
  if (bodyState.error) return bodyState.error;

  const message = bodyState.data.message;

  if (parseResearchCommand(message) || message.trim() === '/analyze') {
    return Response.json({ redirect: true });
  }

  const sessionId = bodyState.data.session_id || crypto.randomUUID();
  const context = await buildContext(userId, 'chat');

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
      let chunkCount = 0;
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
            chunkCount += 1;
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
            logJarvisRequest({
              userId,
              mode: 'chat',
              inputTokens: estimateInputTokens(prompt),
              outputTokens: estimateOutputTokens(fullText),
              durationMs: Date.now() - startedAt,
              success: true,
              sourceCount: 0,
              chunkCount,
            }),
          ]);
        } catch {
          send('error', { message: 'Stream interrupted' });
          await logJarvisRequest({
            userId,
            mode: 'chat',
            inputTokens: estimateInputTokens(prompt),
            outputTokens: estimateOutputTokens(fullText),
            durationMs: Date.now() - startedAt,
            success: false,
            sourceCount: 0,
            chunkCount,
          });
        }
      })();

      return () => {
        closeReader();
      };
    });
  } catch {
    await logJarvisRequest({
      userId,
      mode: 'chat',
      inputTokens: estimateInputTokens(prompt),
      outputTokens: 0,
      durationMs: Date.now() - startedAt,
      success: false,
      sourceCount: 0,
      chunkCount: 0,
    });
    return Response.json({ error: 'Failed to start stream' }, { status: 500 });
  }
}

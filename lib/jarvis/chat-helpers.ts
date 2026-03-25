import { getDb } from '@/lib/db';
import { jarvisConversations } from '@/lib/db/schema';
import type { JarvisMode } from '@/lib/jarvis/types';

export interface ResearchCommand {
  ticker: string;
}

/**
 * Parse "/research TICKER" from a chat message.
 * Returns null if the message isn't a research command.
 */
export function parseResearchCommand(message: string): ResearchCommand | null {
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

/**
 * Insert a single message into the jarvis_conversations table.
 */
export async function saveConversation(input: {
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

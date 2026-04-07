import { and, desc, eq } from 'drizzle-orm';
import { agentConversations, agentReports, trades } from '@/lib/db/schema';
import type { AgentDb } from './db';
import type { AgentContext, AgentId } from './types';
import { getMemory } from './memory';

const SYSTEM_AGENT_USER_ID = 'system-agent-user';
const ORCHESTRATOR_AGENT_ID: AgentId = 'orchestrator';

export async function buildContext(
  db: AgentDb,
  userId: string,
  agentId: AgentId,
): Promise<AgentContext> {
  const [memory, recentTrades, conversationHistory, macroSummary] = await Promise.all([
    getMemory(db, userId, agentId),
    db.select()
      .from(trades)
      .where(eq(trades.userId, userId))
      .orderBy(desc(trades.sortKey))
      .limit(20),
    db.select()
      .from(agentConversations)
      .where(and(eq(agentConversations.userId, userId), eq(agentConversations.agentId, agentId)))
      .orderBy(desc(agentConversations.createdAt))
      .limit(20),
    db.select({
      reportJson: agentReports.reportJson,
    })
      .from(agentReports)
      .where(and(
        eq(agentReports.userId, SYSTEM_AGENT_USER_ID),
        eq(agentReports.agentId, ORCHESTRATOR_AGENT_ID),
        eq(agentReports.reportType, 'macro-summary'),
        eq(agentReports.status, 'published'),
      ))
      .orderBy(desc(agentReports.createdAt))
      .limit(1),
  ]);

  return {
    recentTrades: recentTrades as unknown[],
    macroSummary: macroSummary[0]?.reportJson ?? null,
    memory,
    conversationHistory: conversationHistory as unknown[],
  };
}

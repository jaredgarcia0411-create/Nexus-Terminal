import { and, desc, eq } from 'drizzle-orm';
import { agentConversations, agentReports, trades } from '@/lib/db/schema';
import type { AgentDb } from './db';
import type { AgentContext, AgentId, MacroSummaryReport } from './types';
import { getMemory } from './memory';

const SYSTEM_AGENT_USER_ID = 'system-agent-user';
const ORCHESTRATOR_AGENT_ID: AgentId = 'orchestrator';

function normalizeMacroSummaryReport(value: unknown): MacroSummaryReport | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const report = value as Partial<MacroSummaryReport>;
  if (
    (report.marketBias !== 'bullish' && report.marketBias !== 'bearish' && report.marketBias !== 'neutral')
    || typeof report.summary !== 'string'
    || (report.confidence !== 'high' && report.confidence !== 'medium' && report.confidence !== 'low')
  ) {
    return null;
  }

  const scenario = report.scenarioAnalysis && typeof report.scenarioAnalysis === 'object'
    ? report.scenarioAnalysis
    : null;

  return {
    tradingDate: typeof report.tradingDate === 'string' ? report.tradingDate : '',
    marketBias: report.marketBias,
    summary: report.summary,
    riskAssessment: typeof report.riskAssessment === 'string' ? report.riskAssessment : '',
    drivers: Array.isArray(report.drivers) ? report.drivers : [],
    crossAssetSnapshot: Array.isArray(report.crossAssetSnapshot) ? report.crossAssetSnapshot : [],
    keyLevels: Array.isArray(report.keyLevels) ? report.keyLevels : [],
    ratesOutlook: typeof report.ratesOutlook === 'string' ? report.ratesOutlook : '',
    fredData: Array.isArray(report.fredData) ? report.fredData : [],
    scheduledCatalysts: Array.isArray(report.scheduledCatalysts) ? report.scheduledCatalysts : [],
    sectorRotation: Array.isArray(report.sectorRotation) ? report.sectorRotation : [],
    scenarioAnalysis: {
      consensus: typeof scenario?.consensus === 'string' ? scenario.consensus : '',
      disruption: typeof scenario?.disruption === 'string' ? scenario.disruption : '',
    },
    deskImplications: Array.isArray(report.deskImplications) ? report.deskImplications : [],
    sourceIndex: Array.isArray(report.sourceIndex) ? report.sourceIndex : [],
    confidence: report.confidence,
    tldr: Array.isArray(report.tldr) ? report.tldr : [],
  };
}

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

  const latestMacroSummary = macroSummary[0]?.reportJson;

  return {
    recentTrades: recentTrades as unknown[],
    macroSummary: normalizeMacroSummaryReport(latestMacroSummary),
    memory,
    conversationHistory: conversationHistory as unknown[],
  };
}

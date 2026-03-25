import { getDb } from '@/lib/db';
import { agentMemory } from '@/lib/db/schema';
import type { JarvisMemoryCategory, TradeAnalysisOutput } from '@/lib/jarvis/types';

export async function upsertMemory(
  userId: string,
  category: JarvisMemoryCategory,
  key: string,
  value: string,
  valueJson?: unknown,
) {
  const db = getDb();
  if (!db) return;

  await db.insert(agentMemory).values({
    id: crypto.randomUUID(),
    userId,
    category,
    key,
    value,
    valueJson: valueJson ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [agentMemory.userId, agentMemory.category, agentMemory.key],
    set: {
      value,
      valueJson: valueJson ?? null,
      updatedAt: new Date(),
    },
  });
}

export async function extractTradeInsights(userId: string, analysisResult: TradeAnalysisOutput) {
  const insights = [
    ...analysisResult.patterns.map((pattern, index) => ({
      key: `pattern_${index + 1}`,
      value: pattern,
    })),
    ...analysisResult.strengths.slice(0, 2).map((strength, index) => ({
      key: `strength_${index + 1}`,
      value: strength,
    })),
  ];

  await Promise.all(
    insights.map((insight) => upsertMemory(userId, 'trade_insight', insight.key, insight.value, { source: 'trade-analysis' })),
  );
}

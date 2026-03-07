import { desc, ne, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { jarvisKnowledgeChunks } from '@/lib/db/schema';
import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { requireJarvisAdmin } from '@/lib/jarvis-admin';

export async function GET(request: Request) {
  try {
    const adminError = requireJarvisAdmin(request);
    if (adminError) return adminError;

    const db = getDb();
    if (!db) {
      return Response.json({ error: 'Database not configured' }, { status: 503 });
    }

    const [globalRow] = await db.select({
      chunkCount: sql<number>`COUNT(*)`,
      sizeBytes: sql<number>`COALESCE(SUM(octet_length(${jarvisKnowledgeChunks.text})), 0)`,
    })
      .from(jarvisKnowledgeChunks)
      .where(sql`${jarvisKnowledgeChunks.sourceType} = 'web_source'`);

    const userStats = await db.select({
      userId: jarvisKnowledgeChunks.userId,
      chunkCount: sql<number>`COUNT(*)`,
      sizeBytes: sql<number>`COALESCE(SUM(octet_length(${jarvisKnowledgeChunks.text})), 0)`,
    })
      .from(jarvisKnowledgeChunks)
      .where(ne(jarvisKnowledgeChunks.sourceType, 'web_source'))
      .groupBy(jarvisKnowledgeChunks.userId)
      .orderBy(desc(sql<number>`COALESCE(SUM(octet_length(${jarvisKnowledgeChunks.text})), 0)`));

    return Response.json({
      globalChunks: Number(globalRow?.chunkCount ?? 0),
      globalSizeBytes: Number(globalRow?.sizeBytes ?? 0),
      userStats: userStats.map((row) => ({
        userId: row.userId,
        chunkCount: Number(row.chunkCount ?? 0),
        sizeBytes: Number(row.sizeBytes ?? 0),
      })),
    });
  } catch (error) {
    logRouteError('jarvis.admin.memory.stats', error);
    return internalServerError();
  }
}

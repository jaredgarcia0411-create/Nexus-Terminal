import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { jarvisKnowledgeChunks } from '@/lib/db/schema';
import { internalServerError, logRouteError, parseJsonBody } from '@/lib/api-route-utils';
import { requireJarvisAdmin } from '@/lib/jarvis-admin';

interface PurgeRequest {
  userId?: string;
  sourceUrl?: string;
  all?: boolean;
}

export async function DELETE(request: Request) {
  try {
    const adminError = requireJarvisAdmin(request);
    if (adminError) return adminError;

    const db = getDb();
    if (!db) {
      return Response.json({ error: 'Database not configured' }, { status: 503 });
    }

    const bodyState = await parseJsonBody<PurgeRequest>(request);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    if (body.all) {
      const deletedRows = await db.delete(jarvisKnowledgeChunks)
        .returning({ id: jarvisKnowledgeChunks.id });
      return Response.json({ deleted: deletedRows.length });
    }

    const predicates = [
      body.userId ? eq(jarvisKnowledgeChunks.userId, body.userId.trim()) : undefined,
      body.sourceUrl ? eq(jarvisKnowledgeChunks.sourceUrl, body.sourceUrl.trim()) : undefined,
    ].filter((value): value is NonNullable<typeof value> => Boolean(value));

    if (predicates.length === 0) {
      return Response.json({ error: 'Provide one of: all=true, userId, sourceUrl.' }, { status: 400 });
    }

    const deletedRows = await db.delete(jarvisKnowledgeChunks)
      .where(and(...predicates))
      .returning({ id: jarvisKnowledgeChunks.id });

    return Response.json({ deleted: deletedRows.length });
  } catch (error) {
    logRouteError('jarvis.admin.memory.purge', error);
    return internalServerError();
  }
}

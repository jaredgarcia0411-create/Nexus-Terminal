import { and, eq } from 'drizzle-orm';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { dbUnavailable } from '@/lib/server-db-utils';
import { getDb } from '@/lib/db';
import { agentMemory } from '@/lib/db/schema';
import { requireJarvisAdmin } from '@/lib/jarvis/admin';
import { adminMemoryDeleteBodySchema } from '@/lib/validations/system';

export async function GET(request: Request) {
  try {
    const adminError = requireJarvisAdmin(request);
    if (adminError) return adminError;

    const db = getDb();
    if (!db) {
      return dbUnavailable();
    }

    const url = new URL(request.url);
    const userId = url.searchParams.get('userId')?.trim();
    const category = url.searchParams.get('category')?.trim();

    const predicates = [
      userId ? eq(agentMemory.userId, userId) : undefined,
      category ? eq(agentMemory.category, category) : undefined,
    ].filter((value): value is NonNullable<typeof value> => Boolean(value));

    const rows = predicates.length > 0
      ? await db.select().from(agentMemory).where(and(...predicates))
      : await db.select().from(agentMemory);

    return Response.json({ rows });
  } catch (error) {
    logRouteError('jarvis.admin.memory.get', error);
    return internalServerError();
  }
}

export async function DELETE(request: Request) {
  try {
    const adminError = requireJarvisAdmin(request);
    if (adminError) return adminError;

    const db = getDb();
    if (!db) {
      return dbUnavailable();
    }

    const bodyState = await parseAndValidate(request, adminMemoryDeleteBodySchema);
    if (bodyState.error) return bodyState.error;

    const body = bodyState.data;
    if (body.all) {
      const deleted = await db.delete(agentMemory).returning({ id: agentMemory.id });
      return Response.json({ deleted: deleted.length });
    }

    const predicates = [
      body.userId ? eq(agentMemory.userId, body.userId.trim()) : undefined,
      body.category ? eq(agentMemory.category, body.category.trim()) : undefined,
    ].filter((value): value is NonNullable<typeof value> => Boolean(value));

    if (predicates.length === 0) {
      return Response.json({ error: 'Provide one of: all=true, userId, category.' }, { status: 400 });
    }

    const deleted = await db.delete(agentMemory).where(and(...predicates)).returning({ id: agentMemory.id });
    return Response.json({ deleted: deleted.length });
  } catch (error) {
    logRouteError('jarvis.admin.memory.delete', error);
    return internalServerError();
  }
}

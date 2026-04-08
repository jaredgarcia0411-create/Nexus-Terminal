import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { requireAgentAdmin } from '@/lib/agents/admin';
import { getAgentDb } from '@/lib/agents/db';
import { agentMemoryV2 } from '@/lib/db/schema';
import { dbUnavailable } from '@/lib/server-db-utils';
import { adminMemoryDeleteSchema, adminMemoryListQuerySchema } from '@/lib/validations/agents';

function parseAdminMemoryQuery(request: Request) {
  const result = adminMemoryListQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );

  if (!result.success) {
    return {
      error: Response.json(
        { error: 'Validation failed', details: z.flattenError(result.error) },
        { status: 400 },
      ),
    };
  }

  return { data: result.data };
}

export async function GET(request: Request) {
  try {
    const authError = requireAgentAdmin(request);
    if (authError) return authError;

    const queryState = parseAdminMemoryQuery(request);
    if (queryState.error) return queryState.error;

    const db = getAgentDb();
    if (!db) return dbUnavailable();

    const filters = [
      queryState.data.user_id ? eq(agentMemoryV2.userId, queryState.data.user_id) : null,
      queryState.data.agent_id ? eq(agentMemoryV2.agentId, queryState.data.agent_id) : null,
      queryState.data.category ? eq(agentMemoryV2.category, queryState.data.category) : null,
    ].filter((filter): filter is NonNullable<typeof filter> => filter !== null);

    const query = db.select({
      id: agentMemoryV2.id,
      userId: agentMemoryV2.userId,
      agentId: agentMemoryV2.agentId,
      category: agentMemoryV2.category,
      key: agentMemoryV2.key,
    })
      .from(agentMemoryV2)
      .orderBy(desc(agentMemoryV2.updatedAt))
      .limit(200);

    const rows = filters.length > 0
      ? await query.where(and(...filters))
      : await query;

    return Response.json({
      memory: rows.map((row) => ({
        id: row.id,
        user_id: row.userId,
        agent_id: row.agentId,
        category: row.category,
        key: row.key,
      })),
    });
  } catch (error) {
    logRouteError('agents.admin.memory.get', error);
    return internalServerError();
  }
}

export async function DELETE(request: Request) {
  try {
    const authError = requireAgentAdmin(request);
    if (authError) return authError;

    const bodyState = await parseAndValidate(request, adminMemoryDeleteSchema);
    if (bodyState.error) return bodyState.error;

    const db = getAgentDb();
    if (!db) return dbUnavailable();

    const deletedRows = await db.delete(agentMemoryV2)
      .where(eq(agentMemoryV2.id, bodyState.data.id))
      .returning({ id: agentMemoryV2.id });

    if (deletedRows.length === 0) {
      return Response.json({ error: 'memory row not found' }, { status: 404 });
    }

    return Response.json({ deleted: true });
  } catch (error) {
    logRouteError('agents.admin.memory.delete', error);
    return internalServerError();
  }
}

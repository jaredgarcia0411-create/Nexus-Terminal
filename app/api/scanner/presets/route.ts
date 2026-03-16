import { and, desc, eq } from 'drizzle-orm';
import { internalServerError, logRouteError, parseJsonBody } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { scannerPresets } from '@/lib/db/schema';
import { requireUser } from '@/lib/server-db-utils';

interface PresetBody {
  name?: string;
  filters?: Record<string, unknown>;
}

export async function GET() {
  try {
    const authState = await requireUser();
    if ('error' in authState) {
      return authState.error;
    }

    const db = getDb();
    if (!db) {
      return Response.json({ error: 'Database not configured' }, { status: 503 });
    }

    const rows = await db
      .select({
        id: scannerPresets.id,
        name: scannerPresets.name,
        filtersJson: scannerPresets.filtersJson,
        createdAt: scannerPresets.createdAt,
        updatedAt: scannerPresets.updatedAt,
      })
      .from(scannerPresets)
      .where(eq(scannerPresets.userId, authState.user.id))
      .orderBy(desc(scannerPresets.updatedAt));

    return Response.json({ presets: rows });
  } catch (error) {
    logRouteError('scanner-presets.get', error);
    return internalServerError();
  }
}

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) {
      return authState.error;
    }

    const db = getDb();
    if (!db) {
      return Response.json({ error: 'Database not configured' }, { status: 503 });
    }

    const bodyState = await parseJsonBody<PresetBody>(request);
    if (bodyState.error) {
      return bodyState.error;
    }

    const name = (bodyState.data.name ?? '').trim();
    if (!name) {
      return Response.json({ error: 'name is required' }, { status: 400 });
    }

    if (name.length > 100) {
      return Response.json({ error: 'name must be 100 characters or fewer' }, { status: 400 });
    }

    const filters = bodyState.data.filters ?? {};
    const now = new Date();

    await db
      .insert(scannerPresets)
      .values({
        id: crypto.randomUUID(),
        userId: authState.user.id,
        name,
        filtersJson: filters,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [scannerPresets.userId, scannerPresets.name],
        set: {
          filtersJson: filters,
          updatedAt: now,
        },
      });

    return Response.json({ name, filters });
  } catch (error) {
    logRouteError('scanner-presets.post', error);
    return internalServerError();
  }
}

export async function DELETE(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) {
      return authState.error;
    }

    const db = getDb();
    if (!db) {
      return Response.json({ error: 'Database not configured' }, { status: 503 });
    }

    const { searchParams } = new URL(request.url);
    const id = (searchParams.get('id') ?? '').trim();
    if (!id) {
      return Response.json({ error: 'id is required' }, { status: 400 });
    }

    await db
      .delete(scannerPresets)
      .where(and(eq(scannerPresets.userId, authState.user.id), eq(scannerPresets.id, id)));

    return Response.json({ success: true });
  } catch (error) {
    logRouteError('scanner-presets.delete', error);
    return internalServerError();
  }
}

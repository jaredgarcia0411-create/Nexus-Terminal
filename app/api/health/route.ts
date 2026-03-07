import { getDb } from '@/lib/db';

export async function GET() {
  const db = getDb();
  if (!db) {
    return Response.json({ db: false }, { status: 503 });
  }

  try {
    await db.execute({ sql: 'select 1' });
  } catch {
    return Response.json({ db: false }, { status: 503 });
  }

  return Response.json({ db: true });
}

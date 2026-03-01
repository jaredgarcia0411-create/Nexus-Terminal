import { getDb, initDb } from '@/lib/db';

export async function GET() {
  const db = getDb();
  if (!db) {
    return Response.json({ db: false }, { status: 503 });
  }

  await initDb();
  return Response.json({ db: true });
}

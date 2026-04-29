import { sql } from 'drizzle-orm';

import { getDb } from '@/lib/db';
import { secFilingBodyCache } from '@/lib/db/schema';
import { secFetchText } from '@/lib/sec/client';

export interface FilingBody {
  accessionNumber: string;
  cik: string;
  formType: string;
  filedAt: string;
  text: string;
}

const HTML_ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': '\'',
  '&#x27;': '\'',
  '&nbsp;': ' ',
};

export function stripFilingBodyHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39|#x27|nbsp);/gi, (entity) => HTML_ENTITY_MAP[entity.toLowerCase()] ?? ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function hydrateFromDb(accessionNumber: string): Promise<FilingBody | null> {
  const db = getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(secFilingBodyCache)
    .where(sql`${secFilingBodyCache.accessionNumber} = ${accessionNumber}`);
  const row = rows[0];
  if (!row) return null;

  return {
    accessionNumber: row.accessionNumber,
    cik: row.cik,
    formType: row.formType,
    filedAt: row.filedAt,
    text: row.body,
  };
}

async function persistCache(body: FilingBody): Promise<void> {
  const db = getDb();
  if (!db) return;

  // Filings are immutable once filed, so there is nothing to update on conflict.
  // A concurrent duplicate insert is harmless — drop it silently.
  await db
    .insert(secFilingBodyCache)
    .values({
      accessionNumber: body.accessionNumber,
      cik: body.cik,
      formType: body.formType,
      filedAt: body.filedAt,
      body: body.text,
      fetchedAt: new Date(),
    })
    .onConflictDoNothing({ target: secFilingBodyCache.accessionNumber });
}

export async function getFilingBody(args: {
  accessionNumber: string;
  cik: string;
  formType: string;
  filedAt: string;
  primaryDocUrl: string;
}): Promise<FilingBody | null> {
  if (!args.primaryDocUrl.trim()) return null;

  const cached = await hydrateFromDb(args.accessionNumber);
  if (cached) return cached;

  try {
    const html = await secFetchText(args.primaryDocUrl);
    const text = stripFilingBodyHtml(html);
    const body: FilingBody = {
      accessionNumber: args.accessionNumber,
      cik: args.cik,
      formType: args.formType,
      filedAt: args.filedAt,
      text,
    };
    await persistCache(body).catch((error) => {
      console.warn('[sec-filing-body] persist failed:', error);
    });
    return body;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SEC filing body fetch failed';
    console.warn(`[sec-filing-body] fetch failed for ${args.accessionNumber}: ${message}`);
    return null;
  }
}

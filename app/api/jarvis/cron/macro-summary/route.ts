import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { macroSummaries } from '@/lib/db/schema';
import { callJarvis } from '@/lib/jarvis/client';
import { JARVIS_SYSTEM_PROMPT, buildMacroPrompt } from '@/lib/jarvis/prompts';
import { fetchPageText } from '@/lib/jarvis/scrape-lite';
import { requireUser } from '@/lib/server-db-utils';
import { desc } from 'drizzle-orm';

const MACRO_URLS = [
  'https://www.cnbc.com/economy/',
  'https://www.reuters.com/markets/',
  'https://www.federalreserve.gov/newsevents.htm',
  'https://www.ecb.europa.eu/press/pr/html/index.en.html',
  'https://tradingeconomics.com/calendar',
];

function requireCronSecret(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return Response.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 });
  }

  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token || token !== secret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {
      headline: text.slice(0, 180),
      key_themes: [],
      risk_flags: [],
      watchlist_notes: [],
    };
  }
}

export async function GET(request: Request) {
  try {
    const authError = requireCronSecret(request);
    if (authError) {
      const authState = await requireUser();
      if ('error' in authState) return authError;

      const db = getDb();
      if (!db) return Response.json({ latest: null });

      const [latest] = await db.select({ summaryJson: macroSummaries.summaryJson })
        .from(macroSummaries)
        .orderBy(desc(macroSummaries.generatedAt))
        .limit(1);

      return Response.json({ latest: (latest?.summaryJson as unknown) ?? null });
    }

    const settled = await Promise.allSettled(MACRO_URLS.map((url) => fetchPageText(url)));
    const fetched = settled
      .map((result, index) => ({ result, url: MACRO_URLS[index] }))
      .filter((entry): entry is { result: PromiseFulfilledResult<string>; url: string } => entry.result.status === 'fulfilled');

    const sources = fetched.map((entry) => entry.url);
    const context = {
      user_trades: [],
      macro_summary: null,
      memory: [],
      report_data: {
        sources,
        pages: fetched.map((entry) => ({ url: entry.url, text: entry.result.value })),
      },
    };

    const prompt = buildMacroPrompt(context);
    const llm = await callJarvis(JARVIS_SYSTEM_PROMPT, prompt);
    const parsed = parseJson(llm.content);

    const db = getDb();
    if (db) {
      await db.insert(macroSummaries).values({
        id: crypto.randomUUID(),
        summaryJson: parsed,
        sourcesJson: sources,
        modelUsed: llm.modelUsed,
        generatedAt: new Date(),
      });
    }

    return Response.json({ success: true, sources, summary: parsed });
  } catch (error) {
    logRouteError('jarvis.cron.macro-summary.get', error);
    return internalServerError();
  }
}

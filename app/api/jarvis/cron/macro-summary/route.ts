import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { macroSummaries } from '@/lib/db/schema';
import { callJarvis } from '@/lib/jarvis/client';
import { JARVIS_SYSTEM_PROMPT, buildMacroPrompt } from '@/lib/jarvis/prompts';
import { fetchPageText } from '@/lib/jarvis/scrape-lite';
import { desc } from 'drizzle-orm';

const MACRO_URLS = [
  'https://www.cnbc.com/economy/',
  'https://www.reuters.com/markets/',
  'https://www.federalreserve.gov/newsevents.htm',
  'https://www.ecb.europa.eu/press/pr/html/index.en.html',
  'https://tradingeconomics.com/calendar',
];

const NEW_YORK_TIME_ZONE = 'America/New_York';

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

function describeError(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'Unknown error';
}

function isMissingJarvisConfig(error: unknown): boolean {
  const message = describeError(error);
  return message.includes('JARVIS_API_KEY') || message.includes('NVIDIA_API_KEY');
}

function isSixAmNewYorkHour(now: Date = new Date()): boolean {
  const hourPart = new Intl.DateTimeFormat('en-US', {
    timeZone: NEW_YORK_TIME_ZONE,
    hour: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).format(now);

  return hourPart === '06';
}

function shouldForceRun(request: Request): boolean {
  const url = new URL(request.url);
  return url.searchParams.get('force') === '1';
}

export async function GET(request: Request) {
  try {
    const authError = requireCronSecret(request);
    if (authError) {
      return authError;
    }

    if (!shouldForceRun(request) && !isSixAmNewYorkHour()) {
      return Response.json({
        success: false,
        skipped: true,
        reason: 'outside_6am_new_york_window',
      }, { status: 202 });
    }

    const settled = await Promise.allSettled(MACRO_URLS.map((url) => fetchPageText(url)));
    const fetched = settled
      .map((result, index) => ({ result, url: MACRO_URLS[index] }))
      .filter((entry): entry is { result: PromiseFulfilledResult<string>; url: string } => entry.result.status === 'fulfilled');

    if (fetched.length === 0) {
      return Response.json({
        error: 'Macro source fetch failed',
        stage: 'scrape',
        attemptedSources: MACRO_URLS.length,
      }, { status: 502 });
    }

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
    let llm: Awaited<ReturnType<typeof callJarvis>>;
    try {
      llm = await callJarvis(JARVIS_SYSTEM_PROMPT, prompt);
    } catch (error) {
      const message = describeError(error);
      logRouteError('jarvis.cron.macro-summary.get.llm', error);
      return Response.json({
        error: isMissingJarvisConfig(error)
          ? 'Jarvis provider is not configured'
          : 'Macro summary generation failed',
        stage: 'llm',
        detail: message,
      }, { status: isMissingJarvisConfig(error) ? 503 : 502 });
    }

    const parsed = parseJson(llm.content);

    const db = getDb();
    if (db) {
      try {
        await db.insert(macroSummaries).values({
          id: crypto.randomUUID(),
          summaryJson: parsed,
          sourcesJson: sources,
          modelUsed: llm.modelUsed,
          generatedAt: new Date(),
        });
      } catch (error) {
        logRouteError('jarvis.cron.macro-summary.get.db', error);
        return Response.json({
          error: 'Macro summary persistence failed',
          stage: 'db',
        }, { status: 500 });
      }
    }

    const failedSourceCount = settled.length - fetched.length;

    if (failedSourceCount > 0) {
      return Response.json({
        success: true,
        sources,
        summary: parsed,
        warnings: [`${failedSourceCount} macro source fetches failed`],
      });
    }

    return Response.json({ success: true, sources, summary: parsed });
  } catch (error) {
    logRouteError('jarvis.cron.macro-summary.get', error);
    return internalServerError();
  }
}

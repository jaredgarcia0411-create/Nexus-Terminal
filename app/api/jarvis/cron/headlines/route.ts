import { getMacroAllowlistDomains, getTrustScoreForHost } from '@/lib/jarvis-allowlist';
import { ingestKnowledgeChunks } from '@/lib/jarvis-knowledge';
import { isRobotAllowed } from '@/lib/jarvis-robots';
import { isUrlFreshInCache } from '@/lib/jarvis-scrape-cache';
import {
  buildStructuredSource,
  chunkScrapedSource,
  dedupeSourceChunks,
  rankSourceChunks,
} from '@/lib/jarvis-scrape';

const SCRAPE_TIMEOUT_MS = 10_000;
const SYSTEM_USER_ID = 'system';

const DOMAIN_URLS: Record<string, string> = {
  'cnbc.com': 'https://www.cnbc.com/economy/',
  'reuters.com': 'https://www.reuters.com/markets/',
  'investing.com': 'https://www.investing.com/news/economy',
  'federalreserve.gov': 'https://www.federalreserve.gov/newsevents.htm',
  'ecb.europa.eu': 'https://www.ecb.europa.eu/press/pr/html/index.en.html',
  'tradingeconomics.com': 'https://tradingeconomics.com/calendar',
  'boj.or.jp': 'https://www.boj.or.jp/en/mopo/index.htm',
  'nikkei.com': 'https://asia.nikkei.com/Economy',
  'imf.org': 'https://www.imf.org/en/News',
  'worldbank.org': 'https://www.worldbank.org/en/news',
};

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

export async function GET(request: Request) {
  const authError = requireCronSecret(request);
  if (authError) return authError;

  const start = Date.now();
  const macroDomains = getMacroAllowlistDomains();
  const errors: string[] = [];
  let totalScraped = 0;
  let totalIngested = 0;

  for (const entry of macroDomains) {
    const url = DOMAIN_URLS[entry.domain];
    if (!url) {
      errors.push(`No URL mapping for domain: ${entry.domain}`);
      continue;
    }

    const robotsAllowed = await isRobotAllowed(url);
    if (!robotsAllowed) {
      errors.push(`${entry.domain}: blocked by robots.txt`);
      continue;
    }

    const cacheResult = await isUrlFreshInCache(url, 'cached_headline');
    if (cacheResult.isFresh) {
      totalScraped += 1;
      continue;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);

      let res: Response;
      try {
        res = await fetch(url, {
          headers: { 'User-Agent': 'Nexus-Jarvis/1.0' },
          cache: 'no-store',
          signal: controller.signal,
        });
      } catch (fetchError) {
        clearTimeout(timeout);
        const msg = fetchError instanceof Error ? fetchError.message : 'Unknown error';
        errors.push(`${entry.domain}: ${msg}`);
        continue;
      }
      clearTimeout(timeout);

      if (!res.ok) {
        errors.push(`${entry.domain}: HTTP ${res.status}`);
        continue;
      }

      const html = await res.text();
      const source = buildStructuredSource(url, html, new Date());
      const rawChunks = chunkScrapedSource(source);
      const deduped = dedupeSourceChunks(rawChunks);
      const ranked = rankSourceChunks(deduped, {
        tradeTickers: [],
        trustByHost: { [source.host]: getTrustScoreForHost(source.host) },
      });

      totalScraped += 1;

      await ingestKnowledgeChunks({
        userId: SYSTEM_USER_ID,
        sourceType: 'cached_headline',
        chunks: ranked,
      });

      totalIngested += ranked.length;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      errors.push(`${entry.domain}: ${msg}`);
    }
  }

  const durationMs = Date.now() - start;

  return Response.json({
    scraped: totalScraped,
    ingested: totalIngested,
    errors,
    durationMs,
  });
}

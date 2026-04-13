const DEFAULT_TIMEOUT_MS = 10_000;

export interface RssItem {
  title: string;
  link: string;
  pubDate: string;
}

/**
 * Fetch and parse an RSS 2.0 feed. Returns up to `limit` items.
 * Uses regex extraction - no XML parser dependency needed.
 */
export async function fetchRssItems(
  url: string,
  options?: { timeoutMs?: number; limit?: number },
): Promise<RssItem[]> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const limit = options?.limit ?? 10;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Nexus-Agent/1.0',
        Accept: 'application/rss+xml, application/xml, text/xml',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`RSS fetch failed with status ${response.status}`);
    }

    const xml = await response.text();
    const items: RssItem[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match: RegExpExecArray | null;

    while ((match = itemRegex.exec(xml)) !== null && items.length < limit) {
      const block = match[1]!;
      const title = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1]?.trim() ?? '';
      const link = block.match(/<link>([\s\S]*?)<\/link>/i)?.[1]?.trim() ?? '';
      const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1]?.trim() ?? '';

      if (title) {
        items.push({ title, link, pubDate });
      }
    }

    return items;
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') {
      throw new Error(`RSS fetch timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

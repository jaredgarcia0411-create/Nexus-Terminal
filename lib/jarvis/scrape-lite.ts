function stripHtml(input: string) {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function fetchPageText(url: string): Promise<string> {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { 'User-Agent': 'Nexus-Jarvis/1.0' },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url} (${response.status})`);
  }

  const html = await response.text();
  return stripHtml(html).slice(0, 30_000);
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TEXT_LENGTH = 30_000;
const ERROR_BODY_LIMIT = 240;

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, '\'');
}

function normalizeHtmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function readFailureDetailFromPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const parsed = payload as {
    error?: string | { message?: string };
    message?: string;
  };

  if (typeof parsed.error === 'string' && parsed.error.trim()) {
    return `: ${parsed.error.trim().slice(0, ERROR_BODY_LIMIT)}`;
  }

  if (
    parsed.error
    && typeof parsed.error === 'object'
    && typeof parsed.error.message === 'string'
    && parsed.error.message.trim()
  ) {
    return `: ${parsed.error.message.trim().slice(0, ERROR_BODY_LIMIT)}`;
  }

  if (typeof parsed.message === 'string' && parsed.message.trim()) {
    return `: ${parsed.message.trim().slice(0, ERROR_BODY_LIMIT)}`;
  }

  return '';
}

async function readFailureDetail(response: Response): Promise<string> {
  const bodyText = (await response.text()).trim();
  if (!bodyText) {
    return '';
  }

  try {
    return readFailureDetailFromPayload(JSON.parse(bodyText));
  } catch {
    return `: ${bodyText.slice(0, ERROR_BODY_LIMIT)}`;
  }
}

export async function fetchPageText(
  url: string,
  options?: { timeoutMs?: number },
): Promise<string> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Nexus-Agent/1.0',
        Accept: 'text/html',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await readFailureDetail(response);
      throw new Error(`Page fetch failed with status ${response.status}${detail}`);
    }

    return normalizeHtmlToText(await response.text()).slice(0, MAX_TEXT_LENGTH);
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') {
      throw new Error(`Page fetch timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

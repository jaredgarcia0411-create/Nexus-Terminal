const SEC_USER_AGENT = 'Nexus Terminal jared.garcia0411@gmail.com';
const MIN_REQUEST_GAP_MS = 100;             // SEC limit is 10 req/s; 100ms is the safe floor
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;

let lastRequestAt = 0;
let pacingPromise: Promise<void> = Promise.resolve();

export class SecHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'SecHttpError';
  }
}

// Serialize the rate-limit gap so concurrent callers respect the 100ms floor.
function paceRequest(): Promise<void> {
  pacingPromise = pacingPromise.then(async () => {
    const wait = Math.max(0, MIN_REQUEST_GAP_MS - (Date.now() - lastRequestAt));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait + 1));
    lastRequestAt = Date.now();
  });
  return pacingPromise;
}

async function delay(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export async function secFetchJson<T = unknown>(url: string): Promise<T> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    await paceRequest();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': SEC_USER_AGENT,
          'Accept': 'application/json',
        },
        signal: controller.signal,
        cache: 'no-store',
      });

      clearTimeout(timeoutId);

      // Retry on transient server errors and rate-limit responses.
      if (response.status === 429 || response.status === 503) {
        lastError = new SecHttpError(response.status, `SEC ${response.status} on attempt ${attempt + 1}`);
        await delay(Math.pow(2, attempt) * 1000);    // 1s, 2s, 4s
        continue;
      }

      if (!response.ok) {
        throw new SecHttpError(response.status, `SEC request failed: ${response.status} ${response.statusText}`);
      }

      return (await response.json()) as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof SecHttpError && error.status >= 400 && error.status < 500 && error.status !== 429) {
        throw error;    // 4xx (other than 429) is not retryable
      }

      lastError = error;

      if (attempt < MAX_RETRIES - 1) {
        await delay(Math.pow(2, attempt) * 1000);
      }
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error('SEC request failed after retries');
}

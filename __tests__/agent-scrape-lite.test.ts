import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchPageText } from '@/lib/agents/scrape-lite';

describe('fetchPageText', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('strips scripts, styles, and html tags into normalized text', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(`
      <html>
        <head>
          <style>.hidden { display: none; }</style>
          <script>window.__BAD__ = true;</script>
        </head>
        <body>
          <h1>Macro</h1>
          <p>Headline</p>
        </body>
      </html>
    `, { status: 200 }));

    await expect(fetchPageText('https://example.com/news')).resolves.toBe('Macro Headline');
  });

  it('decodes the supported html entities', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      '<p>A&nbsp;&amp;&lt;&gt;&quot;&#39;B</p>',
      { status: 200 },
    ));

    await expect(fetchPageText('https://example.com/entities')).resolves.toBe('A &<>"\'B');
  });

  it('caps the normalized text at 30000 characters', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      `<p>${'a'.repeat(35_000)}</p>`,
      { status: 200 },
    ));

    const text = await fetchPageText('https://example.com/long');

    expect(text).toHaveLength(30_000);
    expect(text).toBe('a'.repeat(30_000));
  });

  it('throws on non-2xx responses with the status code and truncated body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      'x'.repeat(300),
      { status: 502 },
    ));

    await expect(fetchPageText('https://example.com/error')).rejects.toThrow(
      `Page fetch failed with status 502: ${'x'.repeat(240)}`,
    );
  });

  it('aborts with the configured timeout', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      const signal = init?.signal as AbortSignal | undefined;
      signal?.addEventListener('abort', () => {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    }));

    const pending = fetchPageText('https://example.com/hang');
    const assertion = expect(pending).rejects.toThrow('Page fetch timed out after 10000ms');
    await vi.advanceTimersByTimeAsync(10_000);

    await assertion;
  });

  it('aborts while reading a non-2xx body when the timeout fires', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      const signal = init?.signal as AbortSignal | undefined;

      return Promise.resolve({
        ok: false,
        status: 502,
        text: () => new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted during body read'), { name: 'AbortError' }));
          });
        }),
      } as Response);
    });

    const pending = fetchPageText('https://example.com/error');
    await Promise.resolve();
    const assertion = expect(pending).rejects.toThrow('Page fetch timed out after 10000ms');
    await vi.advanceTimersByTimeAsync(10_000);

    await assertion;
  });
});

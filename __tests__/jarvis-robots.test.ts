import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearRobotsCache, isRobotAllowed } from '@/lib/jarvis-robots';

function makeTextResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain' },
  });
}

describe('jarvis-robots', () => {
  beforeEach(() => {
    clearRobotsCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearRobotsCache();
    vi.restoreAllMocks();
  });

  it('returns true when robots.txt allows the path', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(makeTextResponse('User-agent: *\nAllow: /\nDisallow: /private'));

    await expect(isRobotAllowed('https://example.com/public')).resolves.toBe(true);
  });

  it('returns false when robots.txt disallows the path for wildcard', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(makeTextResponse('User-agent: *\nDisallow: /admin'));

    await expect(isRobotAllowed('https://example.com/admin/panel')).resolves.toBe(false);
  });

  it('returns false when robots.txt disallows the path for Nexus-Jarvis', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(makeTextResponse('User-agent: *\nAllow: /\n\nUser-agent: Nexus-Jarvis\nDisallow: /sensitive'));

    await expect(isRobotAllowed('https://example.com/sensitive/data')).resolves.toBe(false);
  });

  it('returns true when robots fetch times out', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));

    await expect(isRobotAllowed('https://example.com/timeout')).resolves.toBe(true);
  });

  it('returns true when robots returns 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(makeTextResponse('not found', 404));

    await expect(isRobotAllowed('https://example.com/missing')).resolves.toBe(true);
  });

  it('uses cache for repeated calls to same origin', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeTextResponse('User-agent: *\nAllow: /'));

    await expect(isRobotAllowed('https://example.com/a')).resolves.toBe(true);
    await expect(isRobotAllowed('https://example.com/b')).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/robots.txt', expect.any(Object));
  });

  it('clearRobotsCache forces re-fetch', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeTextResponse('User-agent: *\nAllow: /'));

    await expect(isRobotAllowed('https://example.com/a')).resolves.toBe(true);
    clearRobotsCache();
    await expect(isRobotAllowed('https://example.com/b')).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

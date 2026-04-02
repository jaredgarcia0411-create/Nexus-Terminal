import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  callJarvisStreamingMock,
  checkRateLimitMock,
  buildContextMock,
  ensureUserMock,
  getDbMock,
  logJarvisRequestMock,
  requireUserMock,
} = vi.hoisted(() => ({
  callJarvisStreamingMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  buildContextMock: vi.fn(),
  ensureUserMock: vi.fn(),
  getDbMock: vi.fn(),
  logJarvisRequestMock: vi.fn(),
  requireUserMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ getDb: getDbMock }));
vi.mock('@/lib/jarvis/client', () => ({ callJarvisStreaming: callJarvisStreamingMock }));
vi.mock('@/lib/jarvis/context', () => ({ buildContext: buildContextMock }));
vi.mock('@/lib/jarvis/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/jarvis/rate-limit')>();
  return { ...actual, checkRateLimit: checkRateLimitMock };
});
vi.mock('@/lib/jarvis/token-tracking', () => ({
  logJarvisRequest: logJarvisRequestMock,
}));
vi.mock('@/lib/server-db-utils', () => ({
  dbUnavailable: () => Response.json({ error: 'Database not configured' }, { status: 503 }),
  ensureUser: ensureUserMock,
  requireUser: requireUserMock,
}));

import { POST } from '@/app/api/jarvis/chat/stream/route';

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected response');
  return response;
}

function createStreamingResponse(chunks: string[]) {
  const stream = new ReadableStream<string>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });

  return {
    stream,
    modelUsed: 'test-model',
  };
}

function parseSseEvents(
  body: ReadableStream<Uint8Array> | null,
  maxEvents: number,
  abortController: AbortController,
) {
  return (async () => {
    if (!body) {
      throw new Error('Expected stream body');
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    let buffer = '';

    while (events.length < maxEvents) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const raw = buffer.split('\n\n');
      buffer = raw.pop() ?? '';

      for (const frame of raw) {
        let event = '';
        let dataText = '';
        for (const line of frame.split('\n')) {
          if (line.startsWith('event: ')) event = line.slice(7);
          if (line.startsWith('data: ')) dataText = line.slice(6);
        }

        if (dataText) {
          events.push({ event, data: JSON.parse(dataText) as Record<string, unknown> });
        }
      }
    }

    abortController.abort();
    await reader.cancel();

    return events;
  })();
}

function makeDbMock() {
  const firstMessageLimit = vi.fn(async () => []);
  const insertValuesMock = vi.fn(async () => undefined);

  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: firstMessageLimit,
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: insertValuesMock,
    })),
    _mocks: {
      firstMessageLimit,
      insertValuesMock,
    },
  };
}

describe('jarvis chat stream route', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    requireUserMock.mockResolvedValue({
      user: {
        id: 'u1',
        email: 'user@example.com',
        name: null,
        picture: null,
      },
    });
    ensureUserMock.mockResolvedValue({ id: 'canonical-u1', email: 'user@example.com', name: null, picture: null });
    checkRateLimitMock.mockResolvedValue({ allowed: true, resetAt: Date.now() + 1000 });
    buildContextMock.mockResolvedValue({
      user_trades: [],
      macro_summary: null,
      memory: [],
    });
    callJarvisStreamingMock.mockResolvedValue(createStreamingResponse(['Hello', ' world']));
  });

  it('returns 401 when user is not authenticated', async () => {
    requireUserMock.mockResolvedValueOnce({ error: Response.json({ error: 'Unauthorized' }, { status: 401 }) });

    const db = makeDbMock();
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(await POST(new Request('http://localhost/api/jarvis/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello' }),
    })));

    expect(response.status).toBe(401);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('returns 503 when database is unavailable', async () => {
    getDbMock.mockReturnValue(null);

    const response = ensureResponse(await POST(new Request('http://localhost/api/jarvis/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello' }),
    })));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Database not configured' });
  });

  it('returns redirect signal for research command', async () => {
    const db = makeDbMock();
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(await POST(new Request('http://localhost/api/jarvis/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '/research AAPL' }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ redirect: true });
    expect(db.insert).not.toHaveBeenCalled();
    expect(callJarvisStreamingMock).not.toHaveBeenCalled();
  });

  it('streams chat response tokens and final text', async () => {
    const db = makeDbMock();
    getDbMock.mockReturnValue(db);

    const abortController = new AbortController();
    const response = ensureResponse(await POST(new Request('http://localhost/api/jarvis/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello', session_id: 'session-1' }),
      signal: abortController.signal,
    })));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const events = await parseSseEvents(response.body, 3, abortController);

    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ event: 'token', data: { text: 'Hello' } });
    expect(events[1]).toEqual({ event: 'token', data: { text: ' world' } });
    expect(events[2].event).toBe('done');
    expect(events[2].data).toMatchObject({ fullText: 'Hello world' });

    expect(db._mocks.insertValuesMock).toHaveBeenCalledTimes(2);
    const insertPayloads = db._mocks.insertValuesMock.mock.calls as unknown[][];
    const firstPayload = insertPayloads[0]?.[0] as ({ role: string; content: string; mode: string } | undefined);
    const secondPayload = insertPayloads[1]?.[0] as ({ role: string; content: string; mode: string } | undefined);

    if (!firstPayload || !secondPayload) {
      throw new Error('Expected both conversation inserts');
    }

    expect(firstPayload.role).toBe('user');
    expect(firstPayload.content).toBe('Hello');
    expect(firstPayload.mode).toBe('chat');
    expect(secondPayload.role).toBe('assistant');
    expect(secondPayload.content).toBe('Hello world');
    expect(logJarvisRequestMock).toHaveBeenCalledWith({
      userId: 'canonical-u1',
      mode: 'chat',
      durationMs: expect.any(Number),
      success: true,
    });
  });

  it('returns 429 when Jarvis rate limit is exceeded', async () => {
    checkRateLimitMock.mockResolvedValue({ allowed: false, resetAt: Date.now() + 1500 });

    const db = makeDbMock();
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(await POST(new Request('http://localhost/api/jarvis/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello' }),
    })));

    const payload = await response.json();
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBeDefined();
    expect(payload.error).toBe('Rate limit exceeded. Try again later.');
    expect(callJarvisStreamingMock).not.toHaveBeenCalled();
  });

  it('returns 500 when stream startup fails', async () => {
    callJarvisStreamingMock.mockRejectedValueOnce(new Error('provider down'));

    const db = makeDbMock();
    getDbMock.mockReturnValue(db);

    const response = ensureResponse(await POST(new Request('http://localhost/api/jarvis/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello' }),
    })));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to start stream' });
    expect(db._mocks.insertValuesMock).toHaveBeenCalledTimes(1);
    expect(logJarvisRequestMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'canonical-u1',
      mode: 'chat',
      success: false,
    }));
  });
});

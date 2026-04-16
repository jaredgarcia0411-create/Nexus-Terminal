import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentConversations, agentJobs } from '@/lib/db/schema';

const {
  randomUUIDMock,
  getAgentDbMock,
  ensureUserMock,
  requireServiceAuthMock,
  requireServiceKeyMock,
  resolveDiscordUserMock,
} = vi.hoisted(() => ({
  randomUUIDMock: vi.fn(),
  getAgentDbMock: vi.fn(),
  ensureUserMock: vi.fn(),
  requireServiceAuthMock: vi.fn(),
  requireServiceKeyMock: vi.fn(),
  resolveDiscordUserMock: vi.fn(),
}));

vi.mock('node:crypto', () => ({
  randomUUID: randomUUIDMock,
}));

vi.mock('@/lib/agents/admin', () => ({
  requireServiceAuth: requireServiceAuthMock,
  requireServiceKey: requireServiceKeyMock,
  resolveDiscordUser: resolveDiscordUserMock,
}));

vi.mock('@/lib/agents/db', () => ({
  getAgentDb: getAgentDbMock,
}));

vi.mock('@/lib/server-db-utils', () => ({
  dbUnavailable: () => Response.json({ error: 'Database not configured' }, { status: 503 }),
  ensureUser: ensureUserMock,
}));

import { GET, POST } from '@/app/api/agents/service/chat/route';

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected response');
  return response;
}

function createPostDb() {
  const conversationValuesMock = vi.fn().mockResolvedValue(undefined);
  const jobValuesMock = vi.fn().mockResolvedValue(undefined);

  return {
    insert: vi.fn((table: unknown) => {
      if (table === agentConversations) {
        return { values: conversationValuesMock };
      }

      if (table === agentJobs) {
        return { values: jobValuesMock };
      }

      throw new Error('Unexpected insert table');
    }),
    _mocks: {
      conversationValuesMock,
      jobValuesMock,
    },
  };
}

function createGetDb(job: Record<string, unknown> | null) {
  const limitMock = vi.fn().mockResolvedValue(job ? [job] : []);

  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: limitMock,
        })),
      })),
    })),
    _mocks: {
      limitMock,
    },
  };
}

describe('agent service chat route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    randomUUIDMock.mockReset();
    ensureUserMock.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      name: null,
      picture: null,
    });
    requireServiceAuthMock.mockReturnValue({
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: null,
        picture: null,
      },
      discordUserId: 'discord-user-1',
    });
    requireServiceKeyMock.mockReturnValue(null);
    resolveDiscordUserMock.mockReturnValue({
      id: 'user-1',
      email: 'user@example.com',
      name: null,
      picture: null,
    });
  });

  it('creates a queued chat job on POST success', async () => {
    const db = createPostDb();
    getAgentDbMock.mockReturnValue(db);
    randomUUIDMock.mockReturnValueOnce('conversation-1').mockReturnValueOnce('job-1');

    const response = ensureResponse(await POST(new Request('http://localhost/api/agents/service/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'What moved AAPL today?',
        discord_user_id: 'discord-user-1',
        channel: 'discord',
        session_id: 'session-1',
      }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload).toEqual({
      job_id: 'job-1',
      session_id: 'session-1',
      agent_id: 'orchestrator',
    });
    expect(db._mocks.conversationValuesMock).toHaveBeenCalledWith({
      id: 'conversation-1',
      userId: 'user-1',
      agentId: 'orchestrator',
      sessionId: 'session-1',
      role: 'user',
      content: 'What moved AAPL today?',
      channel: 'discord',
    });
    expect(db._mocks.jobValuesMock).toHaveBeenCalledWith({
      id: 'job-1',
      agentId: 'orchestrator',
      userId: 'user-1',
      jobType: 'chat',
      status: 'queued',
      input: {
        message: 'What moved AAPL today?',
        session_id: 'session-1',
        channel: 'discord',
        discord_user_id: 'discord-user-1',
      },
      priority: 0,
      maxAttempts: 3,
    });
  });

  it('returns 400 when discord_user_id is missing', async () => {
    const response = ensureResponse(await POST(new Request('http://localhost/api/agents/service/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'hello',
        channel: 'discord',
      }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Validation failed');
    expect(payload.details.fieldErrors.discord_user_id).toBeTruthy();
    expect(requireServiceAuthMock).not.toHaveBeenCalled();
  });

  it('returns 400 on GET when the job_id query is missing', async () => {
    const response = ensureResponse(await GET(new Request('http://localhost/api/agents/service/chat')));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Validation failed');
    expect(payload.details.fieldErrors.job_id).toBeTruthy();
    expect(requireServiceKeyMock).not.toHaveBeenCalled();
  });

  it('returns 401 on GET when the service key is invalid', async () => {
    requireServiceKeyMock.mockReturnValueOnce(
      Response.json({ error: 'Unauthorized' }, { status: 401 }),
    );

    const response = ensureResponse(await GET(new Request('http://localhost/api/agents/service/chat?job_id=job-1&discord_user_id=discord-user-1')));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: 'Unauthorized' });
    expect(getAgentDbMock).not.toHaveBeenCalled();
  });

  it('returns 503 on GET when the agent database is unavailable', async () => {
    getAgentDbMock.mockReturnValueOnce(null);

    const response = ensureResponse(await GET(new Request('http://localhost/api/agents/service/chat?job_id=job-1&discord_user_id=discord-user-1')));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({ error: 'Database not configured' });
  });

  it('returns 401 on POST when the service key is invalid', async () => {
    requireServiceAuthMock.mockReturnValueOnce(
      Response.json({ error: 'Unauthorized' }, { status: 401 }),
    );

    const response = ensureResponse(await POST(new Request('http://localhost/api/agents/service/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'hello',
        discord_user_id: 'discord-user-1',
        channel: 'discord',
      }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: 'Unauthorized' });
  });

  it('returns 403 on POST when the Discord user is unknown', async () => {
    requireServiceAuthMock.mockReturnValueOnce(
      Response.json({ error: 'Unknown Discord user' }, { status: 403 }),
    );

    const response = ensureResponse(await POST(new Request('http://localhost/api/agents/service/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'hello',
        discord_user_id: 'discord-user-404',
        channel: 'discord',
      }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ error: 'Unknown Discord user' });
  });

  it('returns 503 on POST when the agent database is unavailable', async () => {
    getAgentDbMock.mockReturnValueOnce(null);

    const response = ensureResponse(await POST(new Request('http://localhost/api/agents/service/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'hello',
        discord_user_id: 'discord-user-1',
        channel: 'discord',
      }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({ error: 'Database not configured' });
  });

  it('returns queued job state on GET', async () => {
    getAgentDbMock.mockReturnValueOnce(createGetDb({
      id: 'job-1',
      agentId: 'orchestrator',
      userId: 'user-1',
      status: 'queued',
      progressNote: null,
      input: { session_id: 'session-1', discord_user_id: 'discord-user-1' },
      result: null,
      errorMessage: null,
      stepLog: [],
    }));

    const response = ensureResponse(await GET(new Request('http://localhost/api/agents/service/chat?job_id=job-1&discord_user_id=discord-user-1')));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      status: 'queued',
      job_id: 'job-1',
      agent_id: 'orchestrator',
      progress_note: null,
    });
  });

  it('returns processing job state on GET', async () => {
    getAgentDbMock.mockReturnValueOnce(createGetDb({
      id: 'job-1',
      agentId: 'orchestrator',
      userId: 'user-1',
      status: 'processing',
      progressNote: 'Thinking',
      input: { session_id: 'session-1', discord_user_id: 'discord-user-1' },
      result: null,
      errorMessage: null,
      stepLog: [],
    }));

    const response = ensureResponse(await GET(new Request('http://localhost/api/agents/service/chat?job_id=job-1&discord_user_id=discord-user-1')));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      status: 'processing',
      job_id: 'job-1',
      agent_id: 'orchestrator',
      progress_note: 'Thinking',
    });
  });

  it('returns completed chat output on GET', async () => {
    getAgentDbMock.mockReturnValueOnce(createGetDb({
      id: 'job-1',
      agentId: 'orchestrator',
      userId: 'user-1',
      status: 'completed',
      progressNote: null,
      input: { session_id: 'session-1', discord_user_id: 'discord-user-1' },
      result: {
        content: 'AAPL moved on earnings.',
      },
      errorMessage: null,
      stepLog: [],
    }));

    const response = ensureResponse(await GET(new Request('http://localhost/api/agents/service/chat?job_id=job-1&discord_user_id=discord-user-1')));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      status: 'completed',
      job_id: 'job-1',
      agent_id: 'orchestrator',
      session_id: 'session-1',
      result: {
        message: 'AAPL moved on earnings.',
      },
    });
  });

  it('returns routed specialist metadata on GET', async () => {
    getAgentDbMock.mockReturnValueOnce(createGetDb({
      id: 'job-1',
      agentId: 'orchestrator',
      userId: 'user-1',
      status: 'completed',
      progressNote: null,
      input: { discord_user_id: 'discord-user-1' },
      result: {
        routed: true,
        specialistJobId: 'job-2',
      },
      errorMessage: null,
      stepLog: [],
    }));

    const response = ensureResponse(await GET(new Request('http://localhost/api/agents/service/chat?job_id=job-1&discord_user_id=discord-user-1')));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      status: 'completed',
      job_id: 'job-1',
      agent_id: 'orchestrator',
      result: {
        routed: true,
        specialistJobId: 'job-2',
      },
    });
  });

  it('returns specialist completion output on GET when a report is available', async () => {
    getAgentDbMock.mockReturnValueOnce(createGetDb({
      id: 'job-1',
      agentId: 'small-cap-trader',
      userId: 'user-1',
      status: 'completed',
      progressNote: null,
      input: { session_id: 'session-1', discord_user_id: 'discord-user-1' },
      result: {
        reportId: 'job-2:research',
        ticker: 'AAPL',
        message: 'Research complete for AAPL.',
      },
      errorMessage: null,
      stepLog: [],
    }));

    const response = ensureResponse(await GET(new Request('http://localhost/api/agents/service/chat?job_id=job-1&discord_user_id=discord-user-1')));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      status: 'completed',
      job_id: 'job-1',
      agent_id: 'small-cap-trader',
      session_id: 'session-1',
      result: {
        routed: false,
        message: 'Research complete for AAPL.',
        reportId: 'job-2:research',
        ticker: 'AAPL',
      },
    });
  });

  it('returns failure details on GET', async () => {
    getAgentDbMock.mockReturnValueOnce(createGetDb({
      id: 'job-1',
      agentId: 'orchestrator',
      userId: 'user-1',
      status: 'failed',
      progressNote: null,
      input: { discord_user_id: 'discord-user-1' },
      result: null,
      errorMessage: 'model unavailable',
      stepLog: [
        {
          errorClass: 'dependency',
        },
      ],
    }));

    const response = ensureResponse(await GET(new Request('http://localhost/api/agents/service/chat?job_id=job-1&discord_user_id=discord-user-1')));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      status: 'failed',
      job_id: 'job-1',
      agent_id: 'orchestrator',
      error: {
        message: 'model unavailable',
        failureClass: 'dependency',
      },
    });
  });

  it('returns 404 on GET when the job is unknown', async () => {
    getAgentDbMock.mockReturnValueOnce(createGetDb(null));

    const response = ensureResponse(await GET(new Request('http://localhost/api/agents/service/chat?job_id=missing-job&discord_user_id=discord-user-1')));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({ error: 'job not found' });
  });

  it('returns 400 on GET when discord_user_id query param is missing', async () => {
    const response = ensureResponse(
      await GET(new Request('http://localhost/api/agents/service/chat?job_id=job-1')),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Validation failed');
    expect(payload.details.fieldErrors.discord_user_id).toBeTruthy();
    expect(requireServiceKeyMock).not.toHaveBeenCalled();
  });

  it('returns 404 on GET when discord_user_id is unknown', async () => {
    resolveDiscordUserMock.mockReturnValueOnce(null);
    getAgentDbMock.mockReturnValueOnce(createGetDb({
      id: 'job-1',
      agentId: 'orchestrator',
      userId: 'user-1',
      status: 'queued',
      progressNote: null,
      input: { discord_user_id: 'discord-user-1' },
      result: null,
      errorMessage: null,
      stepLog: [],
    }));

    const response = ensureResponse(
      await GET(new Request('http://localhost/api/agents/service/chat?job_id=job-1&discord_user_id=discord-user-404')),
    );
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({ error: 'job not found' });
  });

  it('returns 404 on GET when discord_user_id maps to a user but job.userId belongs to a different user', async () => {
    getAgentDbMock.mockReturnValueOnce(createGetDb({
      id: 'job-1',
      agentId: 'orchestrator',
      userId: 'user-OTHER',
      status: 'queued',
      progressNote: null,
      input: { discord_user_id: 'discord-user-1' },
      result: null,
      errorMessage: null,
      stepLog: [],
    }));

    const response = ensureResponse(
      await GET(new Request('http://localhost/api/agents/service/chat?job_id=job-1&discord_user_id=discord-user-1')),
    );
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({ error: 'job not found' });
  });

  it('returns 404 on GET when discord_user_id matches job.userId but job.input.discord_user_id differs', async () => {
    getAgentDbMock.mockReturnValueOnce(createGetDb({
      id: 'job-1',
      agentId: 'orchestrator',
      userId: 'user-1',
      status: 'queued',
      progressNote: null,
      input: { discord_user_id: 'discord-user-DIFFERENT' },
      result: null,
      errorMessage: null,
      stepLog: [],
    }));

    const response = ensureResponse(
      await GET(new Request('http://localhost/api/agents/service/chat?job_id=job-1&discord_user_id=discord-user-1')),
    );
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({ error: 'job not found' });
  });
});

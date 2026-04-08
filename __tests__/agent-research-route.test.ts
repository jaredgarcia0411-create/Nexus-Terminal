import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentJobs } from '@/lib/db/schema';

const {
  randomUUIDMock,
  getAgentDbMock,
  requireUserMock,
  ensureUserMock,
  andMock,
  descMock,
  eqMock,
  neMock,
} = vi.hoisted(() => ({
  randomUUIDMock: vi.fn(),
  getAgentDbMock: vi.fn(),
  requireUserMock: vi.fn(),
  ensureUserMock: vi.fn(),
  andMock: vi.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
  descMock: vi.fn((field: unknown) => ({ type: 'desc', field })),
  eqMock: vi.fn((field: unknown, value: unknown) => ({ type: 'eq', field, value })),
  neMock: vi.fn((field: unknown, value: unknown) => ({ type: 'ne', field, value })),
}));

vi.mock('node:crypto', () => ({
  randomUUID: randomUUIDMock,
}));

vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm');
  return {
    ...actual,
    and: andMock,
    desc: descMock,
    eq: eqMock,
    ne: neMock,
  };
});

vi.mock('@/lib/agents/db', () => ({
  getAgentDb: getAgentDbMock,
}));

vi.mock('@/lib/server-db-utils', () => ({
  dbUnavailable: () => Response.json({ error: 'Database not configured' }, { status: 503 }),
  ensureUser: ensureUserMock,
  requireUser: requireUserMock,
}));

import { GET, POST } from '@/app/api/agents/research/route';

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected response');
  return response;
}

function createResearchPostDb(registryRows: Array<{ status: string }>) {
  const registryLimitMock = vi.fn().mockResolvedValue(registryRows);
  const insertValuesMock = vi.fn().mockResolvedValue(undefined);

  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: registryLimitMock,
        })),
      })),
    })),
    insert: vi.fn((table: unknown) => {
      if (table === agentJobs) {
        return { values: insertValuesMock };
      }

      throw new Error('Unexpected insert table');
    }),
    _mocks: {
      registryLimitMock,
      insertValuesMock,
    },
  };
}

function createResearchGetDb(rows: Array<Record<string, unknown>>) {
  const whereMock = vi.fn(() => ({
    orderBy: vi.fn(() => ({
      limit: vi.fn().mockResolvedValue(rows),
    })),
  }));

  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: whereMock,
      })),
    })),
    _mocks: {
      whereMock,
    },
  };
}

describe('agent research route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    randomUUIDMock.mockReset();
    requireUserMock.mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: null,
        picture: null,
      },
    });
    ensureUserMock.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      name: null,
      picture: null,
    });
  });

  it('queues a research job on POST success', async () => {
    const db = createResearchPostDb([{ status: 'online' }]);
    getAgentDbMock.mockReturnValue(db);
    randomUUIDMock.mockReturnValueOnce('job-1');

    const response = ensureResponse(await POST(new Request('http://localhost/api/agents/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticker: 'AAPL',
        agent_id: 'small-cap-trader',
      }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      job_id: 'job-1',
      agent_id: 'small-cap-trader',
      job_type: 'research',
    });
    expect(db._mocks.insertValuesMock).toHaveBeenCalledWith({
      id: 'job-1',
      agentId: 'small-cap-trader',
      userId: 'user-1',
      jobType: 'research',
      status: 'queued',
      input: {
        ticker: 'AAPL',
      },
    });
  });

  it('returns 401 on POST when auth fails', async () => {
    requireUserMock.mockResolvedValueOnce({
      error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const response = ensureResponse(await POST(new Request('http://localhost/api/agents/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticker: 'AAPL',
        agent_id: 'small-cap-trader',
      }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: 'Unauthorized' });
    expect(getAgentDbMock).not.toHaveBeenCalled();
  });

  it('returns 400 on POST when the ticker is invalid', async () => {
    const response = ensureResponse(await POST(new Request('http://localhost/api/agents/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticker: 'aapl',
        agent_id: 'small-cap-trader',
      }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Validation failed');
    expect(payload.details.fieldErrors.ticker).toBeTruthy();
    expect(getAgentDbMock).not.toHaveBeenCalled();
  });

  it('returns 503 on POST when the agent database is unavailable', async () => {
    getAgentDbMock.mockReturnValueOnce(null);

    const response = ensureResponse(await POST(new Request('http://localhost/api/agents/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticker: 'AAPL',
        agent_id: 'small-cap-trader',
      }),
    })));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({ error: 'Database not configured' });
  });

  it.each(['offline', 'degraded'])(
    'returns 400 on POST when the specialist is %s',
    async (status) => {
      const db = createResearchPostDb([{ status }]);
      getAgentDbMock.mockReturnValue(db);

      const response = ensureResponse(await POST(new Request('http://localhost/api/agents/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: 'AAPL',
          agent_id: 'swing-trader',
        }),
      })));
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload).toEqual({
        error: 'agent unavailable',
        agent_id: 'swing-trader',
        status,
      });
      expect(db._mocks.insertValuesMock).not.toHaveBeenCalled();
    },
  );

  it('returns research reports on GET', async () => {
    const db = createResearchGetDb([
      {
        id: 'report-1',
        agentId: 'small-cap-trader',
        reportType: 'research',
        reportJson: { ticker: 'AAPL' },
      },
    ]);
    getAgentDbMock.mockReturnValue(db);

    const response = ensureResponse(await GET(new Request('http://localhost/api/agents/research')));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      reports: [
        {
          id: 'report-1',
          agent_id: 'small-cap-trader',
          report_type: 'research',
          ticker: 'AAPL',
        },
      ],
    });
  });

  it('returns 503 on GET when the agent database is unavailable', async () => {
    getAgentDbMock.mockReturnValueOnce(null);

    const response = ensureResponse(await GET(new Request('http://localhost/api/agents/research')));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({ error: 'Database not configured' });
  });

  it('excludes system-owned rows from GET list queries', async () => {
    const db = createResearchGetDb([]);
    getAgentDbMock.mockReturnValue(db);

    await GET(new Request('http://localhost/api/agents/research'));

    expect(eqMock).toHaveBeenCalledWith(expect.anything(), 'user-1');
    expect(neMock).toHaveBeenCalledWith(expect.anything(), 'system-agent-user');
    expect(eqMock).toHaveBeenCalledWith(expect.anything(), 'research');
    expect(andMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'eq', value: 'user-1' }),
      expect.objectContaining({ type: 'ne', value: 'system-agent-user' }),
      expect.objectContaining({ type: 'eq', value: 'research' }),
    );
  });
});

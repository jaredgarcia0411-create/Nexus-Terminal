import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireCronSecretMock,
  getAgentDbMock,
} = vi.hoisted(() => ({
  requireCronSecretMock: vi.fn(),
  getAgentDbMock: vi.fn(),
}));

vi.mock('@/lib/server-db-utils', () => ({
  requireCronSecret: requireCronSecretMock,
  dbUnavailable: () => Response.json({ error: 'Database not configured' }, { status: 503 }),
}));

vi.mock('@/lib/agents/db', () => ({
  getAgentDb: getAgentDbMock,
}));

import { GET } from '@/app/api/cron/agent-retention/route';

function createRetentionDb(
  memoryRows: { id: string }[],
  requestLogRows: { id: string }[],
) {
  let deleteCallCount = 0;
  return {
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => {
          deleteCallCount += 1;
          return deleteCallCount === 1 ? memoryRows : requestLogRows;
        }),
      })),
    })),
  };
}

describe('agent-retention cron route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCronSecretMock.mockReturnValue(null);
  });

  it('returns 401 when cron secret is missing or wrong', async () => {
    requireCronSecretMock.mockReturnValueOnce(
      Response.json({ error: 'Unauthorized' }, { status: 401 }),
    );

    const response = await GET(
      new Request('http://localhost/api/cron/agent-retention'),
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: 'Unauthorized' });
    expect(getAgentDbMock).not.toHaveBeenCalled();
  });

  it('returns 503 when database is unavailable', async () => {
    getAgentDbMock.mockReturnValueOnce(null);

    const response = await GET(
      new Request('http://localhost/api/cron/agent-retention', {
        headers: { authorization: 'Bearer valid-secret' },
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({ error: 'Database not configured' });
  });

  it('returns memoryDeleted and requestLogDeleted counts', async () => {
    const db = createRetentionDb(
      [{ id: 'mem-1' }, { id: 'mem-2' }],
      [{ id: 'log-1' }],
    );
    getAgentDbMock.mockReturnValueOnce(db);

    const response = await GET(
      new Request('http://localhost/api/cron/agent-retention', {
        headers: { authorization: 'Bearer valid-secret' },
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ memoryDeleted: 2, requestLogDeleted: 1 });
  });

  it('returns zero counts when both tables are empty', async () => {
    const db = createRetentionDb([], []);
    getAgentDbMock.mockReturnValueOnce(db);

    const response = await GET(
      new Request('http://localhost/api/cron/agent-retention', {
        headers: { authorization: 'Bearer valid-secret' },
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ memoryDeleted: 0, requestLogDeleted: 0 });
  });

  it('continues to delete request-log rows even when memory delete throws', async () => {
    let callCount = 0;
    const db = {
      delete: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => {
            callCount += 1;
            if (callCount === 1) {
              throw new Error('memory delete failed');
            }
            return [{ id: 'log-1' }];
          }),
        })),
      })),
    };
    getAgentDbMock.mockReturnValueOnce(db);

    const response = await GET(
      new Request('http://localhost/api/cron/agent-retention', {
        headers: { authorization: 'Bearer valid-secret' },
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ memoryDeleted: 0, requestLogDeleted: 1 });
  });

  it('continues to delete memory rows even when request-log delete throws', async () => {
    let callCount = 0;
    const db = {
      delete: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => {
            callCount += 1;
            if (callCount === 2) {
              throw new Error('request-log delete failed');
            }
            return [{ id: 'mem-1' }];
          }),
        })),
      })),
    };
    getAgentDbMock.mockReturnValueOnce(db);

    const response = await GET(
      new Request('http://localhost/api/cron/agent-retention', {
        headers: { authorization: 'Bearer valid-secret' },
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ memoryDeleted: 1, requestLogDeleted: 0 });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDbMock, requireUserMock, ensureUserMock, ingestKnowledgeChunksMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  requireUserMock: vi.fn(),
  ensureUserMock: vi.fn(),
  ingestKnowledgeChunksMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getDb: getDbMock,
}));

vi.mock('@/lib/server-db-utils', () => ({
  requireUser: requireUserMock,
  ensureUser: ensureUserMock,
}));

vi.mock('@/lib/jarvis-knowledge', () => ({
  ingestKnowledgeChunks: ingestKnowledgeChunksMock,
}));

import { GET, POST } from '@/app/api/jarvis/upload/route';

async function parseResponse(response: Response | undefined) {
  if (!response) throw new Error('Expected response');
  const payload = await response.json();
  return { status: response.status, payload };
}

function makeDocumentsDb(documents: Array<Record<string, unknown>>) {
  const whereMock = vi.fn(async () => documents);
  const fromMock = vi.fn(() => ({ where: whereMock }));
  const selectMock = vi.fn(() => ({ from: fromMock }));

  return {
    select: selectMock,
    _mocks: { selectMock, fromMock, whereMock },
  };
}

describe('jarvis upload route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: 'user-1', email: 'u@example.com', name: null, picture: null } });
    ensureUserMock.mockResolvedValue(undefined);
    ingestKnowledgeChunksMock.mockResolvedValue(undefined);
  });

  it('returns 400 when form-data does not include file', async () => {
    getDbMock.mockReturnValue({});

    const response = await POST(new Request('http://localhost/api/jarvis/upload', {
      method: 'POST',
      body: new FormData(),
    }));

    const { status, payload } = await parseResponse(response);
    expect(status).toBe(400);
    expect(payload.error).toContain('file');
  });

  it('returns uploaded document metadata list', async () => {
    const dbMock = makeDocumentsDb([
      {
        id: 'doc-1',
        filename: 'playbook.txt',
        mimeType: 'text/plain',
        sizeBytes: 1024,
        status: 'processed',
        chunkCount: 4,
        errorMessage: null,
        createdAt: new Date(),
        processedAt: new Date(),
      },
    ]);
    getDbMock.mockReturnValue(dbMock);

    const response = await GET();
    const { status, payload } = await parseResponse(response);

    expect(status).toBe(200);
    expect(payload.documents).toHaveLength(1);
    expect(payload.documents[0].filename).toBe('playbook.txt');
  });
});

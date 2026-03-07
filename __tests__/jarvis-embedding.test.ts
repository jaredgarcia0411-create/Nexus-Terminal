import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getEmbeddingForText } from '@/lib/jarvis-embedding';

describe('jarvis embedding client', () => {
  beforeEach(() => {
    process.env.NVIDIA_API_KEY = 'nvidia-key';
    process.env.JARVIS_EMBEDDING_ENABLED = 'true';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns embedding array from API response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ embedding: [0.1, 0.2, 0.3] }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const embedding = await getEmbeddingForText('hello world');
    expect(embedding).toEqual([0.1, 0.2, 0.3]);
  });

  it('returns null when embedding is disabled', async () => {
    process.env.JARVIS_EMBEDDING_ENABLED = 'false';
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const embedding = await getEmbeddingForText('hello world');
    expect(embedding).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

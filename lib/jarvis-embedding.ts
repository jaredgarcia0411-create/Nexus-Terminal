export const DEFAULT_JARVIS_EMBEDDING_MODEL = 'nvidia/nv-embedqa-e5-v5';
export const DEFAULT_JARVIS_EMBEDDING_URL = 'https://integrate.api.nvidia.com/v1/embeddings';

function isEmbeddingEnabled() {
  return String(process.env.JARVIS_EMBEDDING_ENABLED ?? 'true').toLowerCase() !== 'false';
}

function normalizeEmbedding(input: unknown) {
  if (!Array.isArray(input)) return null;
  const values = input
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  return values.length > 0 ? values : null;
}

export async function getEmbeddingForText(text: string) {
  const normalized = text.trim();
  if (!normalized || !isEmbeddingEnabled()) return null;

  const apiKey = process.env.JARVIS_API_KEY ?? process.env.NVIDIA_API_KEY;
  if (!apiKey) return null;

  const model = process.env.JARVIS_EMBEDDING_MODEL || DEFAULT_JARVIS_EMBEDDING_MODEL;
  const url = process.env.JARVIS_EMBEDDING_API_BASE_URL || DEFAULT_JARVIS_EMBEDDING_URL;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: normalized,
      }),
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  const payload = (await response.json().catch(() => ({}))) as {
    data?: Array<{ embedding?: unknown }>;
  };

  return normalizeEmbedding(payload.data?.[0]?.embedding);
}

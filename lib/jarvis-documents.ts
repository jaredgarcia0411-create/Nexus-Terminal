import { chunkScrapedSource, extractTickers } from '@/lib/jarvis-scrape';
import { type ScrapedChunk } from '@/lib/jarvis-types';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'text/plain']);

function stableHash(input: string) {
  const normalized = input.trim().toLowerCase();
  let hash = 0x811c9dc5;

  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = (hash * 0x01000193) >>> 0;
  }

  return hash.toString(16);
}

export function getJarvisUploadLimits() {
  return {
    maxBytes: MAX_UPLOAD_BYTES,
    allowedMimeTypes: [...ALLOWED_MIME_TYPES],
  };
}

export function validateJarvisUpload(file: File) {
  if (!file) {
    return 'No file uploaded.';
  }

  if (file.size <= 0) {
    return 'Uploaded file is empty.';
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return `File exceeds the 10MB limit (${Math.ceil(file.size / (1024 * 1024))}MB).`;
  }

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return 'Only PDF and plain text files are supported.';
  }

  return null;
}

async function parsePdfText(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const pdfParseModule = (await import('pdf-parse')) as {
    default?: (input: Buffer) => Promise<{ text?: string }>;
  };
  const parse = pdfParseModule.default;
  if (!parse) {
    throw new Error('PDF parser is unavailable.');
  }

  const result = await parse(buffer);
  return String(result.text ?? '').trim();
}

export async function extractJarvisUploadText(file: File) {
  if (file.type === 'application/pdf') {
    return parsePdfText(file);
  }

  return (await file.text()).trim();
}

export function buildDocumentKnowledgeChunks(options: {
  userId: string;
  documentId: string;
  filename: string;
  text: string;
}) {
  const cleanedText = options.text.trim();
  if (!cleanedText) return [] as ScrapedChunk[];

  const sourceUrl = `jarvis://document/${options.documentId}`;
  const sourceHost = `docs.${options.userId}`;
  const sourceTitle = options.filename;
  const baseTickers = extractTickers(cleanedText);

  const chunks = chunkScrapedSource({
    url: sourceUrl,
    title: sourceTitle,
    host: sourceHost,
    excerpt: cleanedText.slice(0, 2500),
    scrapedAt: new Date(),
    body: cleanedText,
    tickers: baseTickers,
    author: 'user_document',
  });

  return chunks.map((chunk, index) => ({
    ...chunk,
    sourceType: 'user_document' as const,
    sourceTags: [options.filename.toLowerCase()],
    hash: stableHash(`${options.documentId}:${index}:${chunk.text}`),
    relevance: Number((0.65 - index * 0.01).toFixed(3)),
  }));
}

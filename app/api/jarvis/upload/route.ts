import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { jarvisKnowledgeChunks, jarvisUserDocuments } from '@/lib/db/schema';
import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { ensureUser, requireUser } from '@/lib/server-db-utils';
import {
  buildDocumentKnowledgeChunks,
  extractJarvisUploadText,
  validateJarvisUpload,
} from '@/lib/jarvis-documents';
import { ingestKnowledgeChunks } from '@/lib/jarvis-knowledge';

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) {
      return Response.json({ error: 'Database not configured' }, { status: 503 });
    }

    await ensureUser(db, authState.user);

    const form = await request.formData();
    const fileEntry = form.get('file');
    if (!(fileEntry instanceof File)) {
      return Response.json({ error: 'Expected form-data field `file`.' }, { status: 400 });
    }

    const validationError = validateJarvisUpload(fileEntry);
    if (validationError) {
      return Response.json({ error: validationError }, { status: 400 });
    }

    const documentId = crypto.randomUUID();
    const now = new Date();

    await db.insert(jarvisUserDocuments)
      .values({
        id: documentId,
        userId: authState.user.id,
        filename: fileEntry.name,
        mimeType: fileEntry.type,
        sizeBytes: fileEntry.size,
        status: 'processing',
        createdAt: now,
      });

    try {
      const extractedText = await extractJarvisUploadText(fileEntry);
      if (!extractedText) {
        throw new Error('No readable text content found in uploaded file.');
      }

      const chunks = buildDocumentKnowledgeChunks({
        userId: authState.user.id,
        documentId,
        filename: fileEntry.name,
        text: extractedText,
      });

      await ingestKnowledgeChunks({
        userId: authState.user.id,
        sourceType: 'user_document',
        chunks,
      });

      await db.update(jarvisUserDocuments)
        .set({
          status: 'processed',
          chunkCount: chunks.length,
          processedAt: new Date(),
          errorMessage: null,
        })
        .where(and(
          eq(jarvisUserDocuments.id, documentId),
          eq(jarvisUserDocuments.userId, authState.user.id),
        ));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to process uploaded document.';

      await db.update(jarvisUserDocuments)
        .set({
          status: 'failed',
          errorMessage: message,
          processedAt: new Date(),
        })
        .where(and(
          eq(jarvisUserDocuments.id, documentId),
          eq(jarvisUserDocuments.userId, authState.user.id),
        ));

      return Response.json({ error: message }, { status: 400 });
    }

    const [document] = await db.select({
      id: jarvisUserDocuments.id,
      filename: jarvisUserDocuments.filename,
      mimeType: jarvisUserDocuments.mimeType,
      sizeBytes: jarvisUserDocuments.sizeBytes,
      status: jarvisUserDocuments.status,
      chunkCount: jarvisUserDocuments.chunkCount,
      createdAt: jarvisUserDocuments.createdAt,
      processedAt: jarvisUserDocuments.processedAt,
      errorMessage: jarvisUserDocuments.errorMessage,
    })
      .from(jarvisUserDocuments)
      .where(and(
        eq(jarvisUserDocuments.id, documentId),
        eq(jarvisUserDocuments.userId, authState.user.id),
      ));

    return Response.json({ document });
  } catch (error) {
    logRouteError('jarvis.upload.post', error);
    return internalServerError();
  }
}

export async function GET() {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) {
      return Response.json({ error: 'Database not configured' }, { status: 503 });
    }

    const documents = await db.select({
      id: jarvisUserDocuments.id,
      filename: jarvisUserDocuments.filename,
      mimeType: jarvisUserDocuments.mimeType,
      sizeBytes: jarvisUserDocuments.sizeBytes,
      status: jarvisUserDocuments.status,
      chunkCount: jarvisUserDocuments.chunkCount,
      errorMessage: jarvisUserDocuments.errorMessage,
      createdAt: jarvisUserDocuments.createdAt,
      processedAt: jarvisUserDocuments.processedAt,
    })
      .from(jarvisUserDocuments)
      .where(eq(jarvisUserDocuments.userId, authState.user.id));

    return Response.json({ documents });
  } catch (error) {
    logRouteError('jarvis.upload.get', error);
    return internalServerError();
  }
}

export async function DELETE(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) {
      return Response.json({ error: 'Database not configured' }, { status: 503 });
    }

    const url = new URL(request.url);
    const documentId = url.searchParams.get('id')?.trim();
    if (!documentId) {
      return Response.json({ error: 'Missing required query param: id' }, { status: 400 });
    }

    const sourceUrl = `jarvis://document/${documentId}`;

    const deletedDocument = await db.delete(jarvisUserDocuments)
      .where(and(
        eq(jarvisUserDocuments.id, documentId),
        eq(jarvisUserDocuments.userId, authState.user.id),
      ))
      .returning({ id: jarvisUserDocuments.id });

    if (deletedDocument.length === 0) {
      return Response.json({ error: 'Document not found.' }, { status: 404 });
    }

    await db.delete(jarvisKnowledgeChunks)
      .where(and(
        eq(jarvisKnowledgeChunks.userId, authState.user.id),
        eq(jarvisKnowledgeChunks.sourceType, 'user_document'),
        eq(jarvisKnowledgeChunks.sourceUrl, sourceUrl),
      ));

    return Response.json({ deleted: documentId });
  } catch (error) {
    logRouteError('jarvis.upload.delete', error);
    return internalServerError();
  }
}

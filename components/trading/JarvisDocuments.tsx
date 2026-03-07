'use client';

import React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Loader2, Trash2, Upload } from 'lucide-react';

type JarvisDocument = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: 'pending' | 'processing' | 'processed' | 'failed';
  chunkCount: number;
  errorMessage?: string | null;
  createdAt?: string;
  processedAt?: string | null;
};

function statusClassName(status: JarvisDocument['status']) {
  if (status === 'processed') return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200';
  if (status === 'failed') return 'border-rose-500/40 bg-rose-500/15 text-rose-200';
  if (status === 'processing') return 'border-amber-500/40 bg-amber-500/15 text-amber-200';
  return 'border-zinc-500/40 bg-zinc-500/15 text-zinc-200';
}

function humanBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function JarvisDocuments() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [documents, setDocuments] = useState<JarvisDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sortedDocuments = useMemo(() => [...documents].sort((a, b) => {
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  }), [documents]);

  const reloadDocuments = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/jarvis/upload', { method: 'GET' });
      const payload = (await response.json().catch(() => ({}))) as { documents?: JarvisDocument[]; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? 'Unable to load documents.');
      }
      setDocuments(Array.isArray(payload.documents) ? payload.documents : []);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load documents.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reloadDocuments();
  }, []);

  const uploadFile = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('file', file);

      const response = await fetch('/api/jarvis/upload', {
        method: 'POST',
        body: form,
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? 'Upload failed.');
      }
      await reloadDocuments();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Upload failed.');
    } finally {
      setUploading(false);
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    }
  };

  const removeDocument = async (documentId: string) => {
    const confirmed = window.confirm('Delete this document and its indexed chunks?');
    if (!confirmed) return;

    setError(null);
    try {
      const response = await fetch(`/api/jarvis/upload?id=${encodeURIComponent(documentId)}`, { method: 'DELETE' });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? 'Delete failed.');
      }
      await reloadDocuments();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Delete failed.');
    }
  };

  return (
    <div className="space-y-4 rounded-2xl border border-white/5 bg-[#121214] p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-emerald-400">Jarvis Documents</p>
          <p className="mt-1 text-sm text-zinc-300">Upload PDFs or plain text documents (max 10MB) to enrich Jarvis context.</p>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {uploading ? 'Uploading...' : 'Upload Document'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,text/plain"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void uploadFile(file);
            }
          }}
        />
      </div>

      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Uploaded Files</p>
          <button
            type="button"
            onClick={() => void reloadDocuments()}
            className="rounded border border-white/10 px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-white/10"
          >
            Refresh
          </button>
        </div>

        {error ? (
          <p className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>
        ) : null}

        {loading ? (
          <p className="text-sm text-zinc-400">Loading documents...</p>
        ) : sortedDocuments.length === 0 ? (
          <p className="text-sm text-zinc-500">No documents uploaded yet.</p>
        ) : (
          <div className="space-y-2">
            {sortedDocuments.map((document) => (
              <div key={document.id} className="rounded-lg border border-white/10 bg-white/5 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-zinc-100">
                      <FileText className="mr-1 inline h-4 w-4 text-zinc-400" />
                      {document.filename}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {humanBytes(document.sizeBytes)} • {document.chunkCount} chunk(s)
                    </p>
                    {document.errorMessage ? (
                      <p className="mt-1 text-xs text-rose-300">{document.errorMessage}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClassName(document.status)}`}>{document.status}</span>
                    <button
                      type="button"
                      onClick={() => void removeDocument(document.id)}
                      className="rounded border border-rose-500/30 bg-rose-500/10 p-1 text-rose-200 transition-colors hover:bg-rose-500/20"
                      aria-label={`Delete ${document.filename}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

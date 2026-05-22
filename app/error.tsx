'use client';

import { useEffect } from 'react';
import Link from 'next/link';

type ErrorBoundaryProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function Error({ error, reset }: ErrorBoundaryProps) {
  useEffect(() => {
    console.error('[app:error-boundary] unhandled error', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-center p-6 text-center">
        <div className="w-full rounded-2xl border border-rose-500/30 bg-card p-8 shadow-xl">
          <p className="mb-2 text-xs uppercase tracking-[0.3em] text-rose-400">Runtime Error</p>
          <h1 className="text-2xl font-semibold">Something failed to load this page</h1>
          <p className="mt-3 text-sm text-muted-foreground">We hit an unexpected issue. Try again or return once the service is healthy.</p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={reset}
              className="rounded-lg border border-primary/70 bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
              type="button"
            >
              Try again
            </button>

            <Link
              href="/"
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition hover:border-border"
              prefetch={false}
            >
              Go home
            </Link>
          </div>

          {process.env.NODE_ENV === 'development' ? (
            <p className="mt-4 break-all text-xs text-muted-foreground">{error.message}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

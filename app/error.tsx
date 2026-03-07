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
    <div className="min-h-screen bg-[#0A0A0B] text-[#E4E4E7]">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-center p-6 text-center">
        <div className="w-full rounded-2xl border border-rose-500/30 bg-[#121214] p-8 shadow-xl">
          <p className="mb-2 text-xs uppercase tracking-[0.3em] text-rose-400">Runtime Error</p>
          <h1 className="text-2xl font-semibold">Something failed to load this page</h1>
          <p className="mt-3 text-sm text-zinc-400">We hit an unexpected issue. Try again or return once the service is healthy.</p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={reset}
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-emerald-400"
              type="button"
            >
              Try again
            </button>

            <Link
              href="/"
              className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium transition hover:border-white/20"
              prefetch={false}
            >
              Go home
            </Link>
          </div>

          {process.env.NODE_ENV === 'development' ? (
            <p className="mt-4 break-all text-xs text-zinc-500">{error.message}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

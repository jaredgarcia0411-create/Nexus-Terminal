'use client';

import JarvisChat from '@/components/trading/JarvisChat';

export default function JarvisTab() {
  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-white">Jarvis</h1>
        <p className="text-sm text-zinc-400">Chat-powered trading assistant workspace.</p>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#111113] px-4 py-3">
        <p className="text-xs text-zinc-500">Available commands: `/research TICKER`, `/analyze`</p>
      </div>

      <div className="h-[calc(100vh-310px)] min-h-[420px] rounded-xl border border-white/10 bg-black/20 p-4">
        <JarvisChat />
      </div>
    </section>
  );
}

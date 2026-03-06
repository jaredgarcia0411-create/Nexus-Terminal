'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type LinkResponse = {
  linked?: boolean;
  error?: string;
  link?: {
    discordUserId: string;
    guildId: string;
  };
};

export default function DiscordLinkPage() {
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [linked, setLinked] = useState<LinkResponse['link'] | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      toast.error('Enter your Discord link code');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/discord/link/code', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: trimmed }),
      });

      const data = (await res.json().catch(() => ({}))) as LinkResponse;
      if (!res.ok) {
        throw new Error(data.error || 'Could not link Discord account');
      }

      setLinked(data.link ?? null);
      setCode('');
      toast.success('Discord account linked');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not link Discord account';
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0B] p-6 text-[#E4E4E7]">
      <div className="mx-auto max-w-lg rounded-2xl border border-white/10 bg-[#121214] p-8">
        <h1 className="text-2xl font-bold tracking-tight">Link Discord Account</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Run <span className="font-mono text-emerald-400">/link</span> in Discord to get a one-time code, then enter it below.
        </p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <Input
            placeholder="Enter 6-character code"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            maxLength={6}
            className="border-white/10 bg-white/5 font-mono tracking-[0.2em]"
          />
          <Button
            type="submit"
            disabled={submitting}
            className="w-full bg-emerald-500 text-black hover:bg-emerald-400 disabled:opacity-50"
          >
            {submitting ? 'Linking...' : 'Link Discord'}
          </Button>
        </form>

      {linked ? (
        <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-300">
          Linked Discord user <span className="font-mono">{linked.discordUserId}</span> for guild <span className="font-mono">{linked.guildId}</span>.
        </div>
      ) : null}

      <Button
        asChild
        className="mt-6 w-full bg-white/10 text-white hover:bg-white/20"
      >
        <Link href="/">Return to Terminal</Link>
      </Button>
    </div>
  </div>
);
}

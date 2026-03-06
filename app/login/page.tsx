'use client';

import { useState } from 'react';
import { motion } from 'motion/react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'create'>('signin');
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const normalizeUserId = () => userId.trim().toLowerCase();

  const handleSignIn = async () => {
    const normalized = normalizeUserId();
    if (!normalized || !password) {
      toast.error('Enter your User ID and password');
      return;
    }

    setLoading(true);
    try {
      const result = await signIn('credentials', {
        userId: normalized,
        password,
        redirect: false,
      });

      if (result?.error) {
        toast.error('Invalid User ID or password');
        return;
      }

      router.replace('/');
      router.refresh();
    } catch {
      toast.error('Could not sign in right now');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAccount = async () => {
    const normalized = normalizeUserId();
    if (!normalized || !password) {
      toast.error('Enter a User ID and password');
      return;
    }
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const registerRes = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: normalized, password }),
      });

      const payload = (await registerRes.json().catch(() => ({}))) as { error?: string };
      if (!registerRes.ok) {
        toast.error(payload.error ?? 'Could not create account');
        return;
      }

      const result = await signIn('credentials', {
        userId: normalized,
        password,
        redirect: false,
      });

      if (result?.error) {
        toast.error('Account created, but sign in failed. Please sign in manually.');
        setMode('signin');
        return;
      }

      router.replace('/');
      router.refresh();
    } catch {
      toast.error('Could not create account right now');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0A0A0B] p-6 text-[#E4E4E7]">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="w-full max-w-md rounded-2xl border border-white/10 bg-[#121214] p-8 text-center shadow-2xl"
      >
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500 text-lg font-bold text-black">
          N
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Nexus Terminal</h1>
        <p className="mt-2 text-sm text-zinc-400">Sign in with your User ID and password</p>

        <div className="mt-6 space-y-3 text-left">
          <label className="block text-xs uppercase tracking-wider text-zinc-500">
            User ID
            <input
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              placeholder="your-user-id"
              className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-emerald-500/50"
            />
          </label>
          <label className="block text-xs uppercase tracking-wider text-zinc-500">
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
              className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-emerald-500/50"
            />
          </label>
          {mode === 'create' ? (
            <label className="block text-xs uppercase tracking-wider text-zinc-500">
              Confirm Password
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Re-enter password"
                className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-emerald-500/50"
              />
            </label>
          ) : null}
        </div>

        <Button
          disabled={loading}
          onClick={mode === 'signin' ? handleSignIn : handleCreateAccount}
          className="mt-6 w-full bg-emerald-500 text-black hover:bg-emerald-400 disabled:opacity-60"
        >
          {loading ? 'Working...' : mode === 'signin' ? 'Sign In' : 'Create Account'}
        </Button>

        <button
          type="button"
          onClick={() => {
            setMode((current) => (current === 'signin' ? 'create' : 'signin'));
            setConfirmPassword('');
          }}
          className="mt-4 text-xs text-zinc-400 transition-colors hover:text-zinc-200"
        >
          {mode === 'signin' ? 'Need an account? Create one' : 'Already have an account? Sign in'}
        </button>
      </motion.div>
    </div>
  );
}

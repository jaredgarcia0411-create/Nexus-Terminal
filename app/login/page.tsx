'use client';

import { motion } from 'motion/react';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';

export default function LoginPage() {
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
        <p className="mt-2 text-sm text-zinc-400">Sign in to access your trading journal</p>

        <Button
          onClick={() => signIn('google', { callbackUrl: '/' })}
          className="mt-6 w-full bg-emerald-500 text-black hover:bg-emerald-400"
        >
          Sign in with Google
        </Button>
      </motion.div>
    </div>
  );
}

'use client';

import { motion } from 'motion/react';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-2xl"
      >
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">
          N
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Nexus Terminal</h1>
        <p className="mt-2 text-sm text-muted-foreground">Sign in to access your trading journal</p>

        <Button
          onClick={() => signIn('google', { callbackUrl: '/' })}
          className="mt-6 w-full border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
        >
          Sign in with Google
        </Button>
      </motion.div>
    </div>
  );
}

'use client';

import { motion } from 'motion/react';
import Image from 'next/image';
import { signIn } from 'next-auth/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export default function LoginPage() {
  const handleSignIn = () => {
    signIn('google').catch(() => {
      toast.error('Could not start Google sign in');
    });
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
        <p className="mt-2 text-sm text-zinc-400">Professional Trading Journal</p>

        <Button onClick={handleSignIn} className="mt-8 w-full bg-emerald-500 text-black hover:bg-emerald-400">
          <Image src="/google.svg" className="mr-2 h-4 w-4" alt="Google" width={16} height={16} />
          Sign in with Google
        </Button>
      </motion.div>
    </div>
  );
}

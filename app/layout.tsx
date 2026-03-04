import type { Metadata } from 'next';
import { MotionConfig } from 'motion/react';
import { SessionProvider } from 'next-auth/react';
import { Toaster } from 'sonner';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nexus Terminal',
  description: 'Professional trading journal and performance analytics',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body suppressHydrationWarning>
        <SessionProvider>
          <MotionConfig reducedMotion="user">
            {children}
          </MotionConfig>
          <Toaster theme="dark" richColors position="bottom-right" />
        </SessionProvider>
      </body>
    </html>
  );
}

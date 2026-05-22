import type { Metadata } from 'next';
import { MotionConfig } from 'motion/react';
import { SessionProvider } from 'next-auth/react';
import { ThemedToaster } from '@/components/theme/themed-toaster';
import { ThemeProvider } from '@/components/theme/theme-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nexus Terminal',
  description: 'Professional trading journal and performance analytics',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <ThemeProvider>
          <SessionProvider>
            <MotionConfig reducedMotion="user">
              {children}
            </MotionConfig>
            <ThemedToaster />
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

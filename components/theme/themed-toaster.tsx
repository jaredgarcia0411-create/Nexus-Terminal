'use client';

import { useTheme } from 'next-themes';
import { Toaster } from 'sonner';

export function ThemedToaster() {
  const { theme } = useTheme();

  return <Toaster theme={theme === 'light' ? 'light' : 'dark'} richColors position="bottom-right" />;
}

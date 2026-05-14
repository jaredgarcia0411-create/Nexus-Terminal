'use client';

import { useHotkeys } from 'react-hotkeys-hook';
import type { TabKey } from '@/components/trading/Sidebar';

const TAB_KEYS: TabKey[] = ['dashboard', 'management', 'charts', 'research'];

interface GlobalShortcutOptions {
  setActiveTab: (tab: TabKey) => void;
  setCommandPaletteOpen: (open: boolean) => void;
}

export function useGlobalShortcuts({ setActiveTab, setCommandPaletteOpen }: GlobalShortcutOptions): void {
  useHotkeys('1', () => setActiveTab(TAB_KEYS[0]));
  useHotkeys('2', () => setActiveTab(TAB_KEYS[1]));
  useHotkeys('3', () => setActiveTab(TAB_KEYS[2]));
  useHotkeys('4', () => setActiveTab(TAB_KEYS[3]));

  useHotkeys(
    'meta+k, ctrl+k',
    () => setCommandPaletteOpen(true),
    {
      enableOnFormTags: true,
      preventDefault: true,
    },
  );

}

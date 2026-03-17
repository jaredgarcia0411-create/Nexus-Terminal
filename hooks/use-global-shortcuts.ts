'use client';

import { useHotkeys } from 'react-hotkeys-hook';
import type { TabKey } from '@/components/trading/Sidebar';

const TAB_KEYS: TabKey[] = ['dashboard', 'performance', 'journal', 'filter', 'charts', 'markets', 'research', 'jarvis'];

interface GlobalShortcutOptions {
  setActiveTab: (tab: TabKey) => void;
  setCommandPaletteOpen: (open: boolean) => void;
}

export function useGlobalShortcuts({ setActiveTab, setCommandPaletteOpen }: GlobalShortcutOptions): void {
  useHotkeys('1', () => setActiveTab(TAB_KEYS[0]));
  useHotkeys('2', () => setActiveTab(TAB_KEYS[1]));
  useHotkeys('3', () => setActiveTab(TAB_KEYS[2]));
  useHotkeys('4', () => setActiveTab(TAB_KEYS[3]));
  useHotkeys('5', () => setActiveTab(TAB_KEYS[4]));
  useHotkeys('6', () => setActiveTab(TAB_KEYS[5]));
  useHotkeys('7', () => setActiveTab(TAB_KEYS[6]));
  useHotkeys('8', () => setActiveTab(TAB_KEYS[7]));

  useHotkeys(
    'meta+k, ctrl+k',
    () => setCommandPaletteOpen(true),
    {
      enableOnFormTags: true,
      preventDefault: true,
    },
  );

  useHotkeys(
    'meta+j, ctrl+j',
    () => setActiveTab('jarvis'),
    {
      enableOnFormTags: true,
      preventDefault: true,
    },
  );
}

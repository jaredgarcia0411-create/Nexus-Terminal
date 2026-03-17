'use client';

import { useCallback } from 'react';
import { BarChart3, ChartCandlestick, Filter, LayoutGrid, List, MessageSquare, Newspaper, Plus, Search, Upload } from 'lucide-react';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command';
import type { TabKey } from '@/components/trading/Sidebar';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  setActiveTab: (tab: TabKey) => void;
  onNewTradeClick: () => void;
  onImportClick: () => void;
}

const NAV_ITEMS: Array<{
  tab: TabKey;
  label: string;
  icon: typeof LayoutGrid;
  shortcut: string;
}> = [
  { tab: 'dashboard', label: 'Dashboard', icon: LayoutGrid, shortcut: '1' },
  { tab: 'performance', label: 'Performance', icon: BarChart3, shortcut: '2' },
  { tab: 'journal', label: 'Journal', icon: List, shortcut: '3' },
  { tab: 'filter', label: 'Trades', icon: Filter, shortcut: '4' },
  { tab: 'charts', label: 'Charts', icon: ChartCandlestick, shortcut: '5' },
  { tab: 'markets', label: 'Markets', icon: Newspaper, shortcut: '6' },
  { tab: 'research', label: 'Research', icon: Search, shortcut: '7' },
  { tab: 'jarvis', label: 'Jarvis', icon: MessageSquare, shortcut: '8' },
];

export default function CommandPalette({
  open,
  onOpenChange,
  setActiveTab,
  onNewTradeClick,
  onImportClick,
}: CommandPaletteProps) {
  const runCommand = useCallback(
    (command: () => void) => {
      onOpenChange(false);
      command();
    },
    [onOpenChange],
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command Palette"
      description="Search for a command to run..."
      className="border-white/10 bg-[#121214]"
      showCloseButton={false}
    >
      <CommandInput placeholder="Type a command or search..." className="text-zinc-200" />
      <CommandList className="text-zinc-300">
        <CommandEmpty className="text-zinc-500">No results found.</CommandEmpty>

        <CommandGroup heading="Navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <CommandItem
                key={item.tab}
                onSelect={() => runCommand(() => setActiveTab(item.tab))}
                className="data-[selected=true]:bg-white/10"
              >
                <Icon className="mr-2 h-4 w-4 text-zinc-400" />
                {item.label}
                <CommandShortcut>{item.shortcut}</CommandShortcut>
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandGroup heading="Actions">
          <CommandItem
            onSelect={() => runCommand(onNewTradeClick)}
            className="data-[selected=true]:bg-white/10"
          >
            <Plus className="mr-2 h-4 w-4 text-zinc-400" />
            New Trade
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(onImportClick)}
            className="data-[selected=true]:bg-white/10"
          >
            <Upload className="mr-2 h-4 w-4 text-zinc-400" />
            Import CSV
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Jarvis">
          <CommandItem
            onSelect={() => runCommand(() => setActiveTab('jarvis'))}
            className="data-[selected=true]:bg-white/10"
          >
            <MessageSquare className="mr-2 h-4 w-4 text-zinc-400" />
            Chat with Jarvis
            <CommandShortcut>Ctrl+J</CommandShortcut>
          </CommandItem>
          <CommandItem
            keywords={['research', 'dilution', 'edgar']}
            onSelect={() => runCommand(() => setActiveTab('research'))}
            className="data-[selected=true]:bg-white/10"
          >
            <Search className="mr-2 h-4 w-4 text-zinc-400" />
            /research TICKER - Dilution research report
          </CommandItem>
          <CommandItem
            keywords={['analyze', 'trades', 'performance']}
            onSelect={() => runCommand(() => setActiveTab('jarvis'))}
            className="data-[selected=true]:bg-white/10"
          >
            <BarChart3 className="mr-2 h-4 w-4 text-zinc-400" />
            /analyze - Analyze last 30 days of trades
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

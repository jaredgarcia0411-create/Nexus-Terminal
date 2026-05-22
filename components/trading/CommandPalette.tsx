'use client';

import { useCallback } from 'react';
import { ChartCandlestick, LayoutGrid, List, Plus, Search, Upload } from 'lucide-react';
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
  { tab: 'management', label: 'Management', icon: List, shortcut: '2' },
  { tab: 'charts', label: 'Charts', icon: ChartCandlestick, shortcut: '3' },
  { tab: 'research', label: 'Research', icon: Search, shortcut: '4' },
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
      className="border-border bg-card"
      showCloseButton={false}
    >
      <CommandInput placeholder="Type a command or search..." className="text-foreground" />
      <CommandList className="text-muted-foreground">
        <CommandEmpty className="text-muted-foreground">No results found.</CommandEmpty>

        <CommandGroup heading="Navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <CommandItem
                key={item.tab}
                onSelect={() => runCommand(() => setActiveTab(item.tab))}
                className="data-[selected=true]:bg-accent"
              >
                <Icon className="mr-2 h-4 w-4 text-muted-foreground" />
                {item.label}
                <CommandShortcut>{item.shortcut}</CommandShortcut>
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandGroup heading="Actions">
          <CommandItem
            onSelect={() => runCommand(onNewTradeClick)}
            className="data-[selected=true]:bg-accent"
          >
            <Plus className="mr-2 h-4 w-4 text-muted-foreground" />
            New Trade
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(onImportClick)}
            className="data-[selected=true]:bg-accent"
          >
            <Upload className="mr-2 h-4 w-4 text-muted-foreground" />
            Import CSV
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

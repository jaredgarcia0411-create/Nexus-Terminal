'use client';

import { ChevronDown } from 'lucide-react';

import { TAG_TEXT_CLASS } from '@/components/trading/TradeTagEditor';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface TagFilterDropdownProps {
  globalTags: string[];
  selectedTags: Set<string>;
  onToggleTag: (tag: string) => void;
  onClearTags: () => void;
  triggerClassName?: string;
}

export default function TagFilterDropdown({ globalTags, selectedTags, onToggleTag, onClearTags, triggerClassName }: TagFilterDropdownProps) {
  const selectedCount = selectedTags.size;
  const selectedTagNames = globalTags.filter((tag) => selectedTags.has(tag));

  const triggerLabel =
    selectedCount === 0 ? 'All tags' : selectedCount <= 2 ? selectedTagNames.join(', ') : `${selectedCount} selected`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={
            triggerClassName ??
            'flex h-8 w-52 items-center justify-between rounded-md border border-border bg-accent px-3 text-xs text-foreground transition-colors hover:bg-accent'
          }
        >
          <span className="truncate">{triggerLabel}</span>
          <span className="ml-2 flex items-center gap-1 text-muted-foreground">
            {selectedCount > 2 ? <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">{selectedCount}</span> : null}
            <ChevronDown className="h-3.5 w-3.5" />
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-52 border-border bg-card text-foreground" align="start">
        <DropdownMenuLabel className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Select tags</DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-accent" />

        {selectedCount > 0 ? (
          <>
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                onClearTags();
              }}
              className="text-xs text-muted-foreground"
            >
              Clear tag filters
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-accent" />
          </>
        ) : null}

        {globalTags.map((tag) => (
          <DropdownMenuCheckboxItem
            key={tag}
            checked={selectedTags.has(tag)}
            onCheckedChange={() => onToggleTag(tag)}
            onSelect={(event) => event.preventDefault()}
            className="data-[state=checked]:text-primary"
          >
            <span className={TAG_TEXT_CLASS}>{tag}</span>
          </DropdownMenuCheckboxItem>
        ))}

        {globalTags.length === 0 ? <DropdownMenuItem disabled className="text-xs italic text-muted-foreground">No tags created yet.</DropdownMenuItem> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

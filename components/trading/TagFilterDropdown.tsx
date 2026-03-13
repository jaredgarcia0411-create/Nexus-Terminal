'use client';

import { ChevronDown } from 'lucide-react';
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
            'flex h-8 w-56 items-center justify-between rounded-md border border-white/10 bg-white/5 px-3 text-xs text-zinc-200 transition-colors hover:bg-white/10'
          }
        >
          <span className="truncate">{triggerLabel}</span>
          <span className="ml-2 flex items-center gap-1 text-zinc-400">
            {selectedCount > 2 ? <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">{selectedCount}</span> : null}
            <ChevronDown className="h-3.5 w-3.5" />
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56 border-white/10 bg-[#18181b] text-white" align="start">
        <DropdownMenuLabel className="text-xs font-mono uppercase tracking-wider text-zinc-500">Select tags</DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-white/10" />

        {selectedCount > 0 ? (
          <>
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                onClearTags();
              }}
              className="text-xs text-zinc-300"
            >
              Clear tag filters
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-white/10" />
          </>
        ) : null}

        {globalTags.map((tag) => (
          <DropdownMenuCheckboxItem
            key={tag}
            checked={selectedTags.has(tag)}
            onCheckedChange={() => onToggleTag(tag)}
            onSelect={(event) => event.preventDefault()}
            className="text-xs data-[state=checked]:text-emerald-400"
          >
            {tag}
          </DropdownMenuCheckboxItem>
        ))}

        {globalTags.length === 0 ? <DropdownMenuItem disabled className="text-xs italic text-zinc-500">No tags created yet.</DropdownMenuItem> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

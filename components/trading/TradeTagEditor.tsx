'use client';

import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export const TAG_TEXT_CLASS = 'text-xs text-foreground';

interface TradeTagEditorProps {
  tags: string[];
  globalTags: string[];
  readOnly?: boolean;
  maxWidthClassName?: string;
  emptyLabel?: string;
  onAddTag?: (tagName: string) => void;
  onRemoveTag?: (tagName: string) => void;
  onDeleteGlobalTag?: (tagName: string) => void;
}

export default function TradeTagEditor({
  tags,
  globalTags,
  readOnly = false,
  maxWidthClassName,
  emptyLabel = '-',
  onAddTag,
  onRemoveTag,
  onDeleteGlobalTag,
}: TradeTagEditorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const availableTags = useMemo(
    () => globalTags.filter((tag) => !tags.includes(tag)),
    [globalTags, tags],
  );

  const addTag = (raw: string) => {
    const next = raw.trim();
    if (!next) return;
    onAddTag?.(next);
    setQuery('');
    setOpen(false);
  };

  if (readOnly) {
    if (tags.length === 0) {
      return <span className="text-muted-foreground">{emptyLabel}</span>;
    }

    return (
      <div className={`flex flex-wrap items-center gap-1 ${maxWidthClassName ?? ''}`}>
        {tags.map((tag) => (
          <span key={tag} className={TAG_TEXT_CLASS}>
            {tag}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-1 ${maxWidthClassName ?? ''}`}>
      {tags.map((tag) => (
        <span key={tag} className={`flex items-center gap-1 ${TAG_TEXT_CLASS} group/tag`}>
          {tag}
          <button
            type="button"
            onClick={() => onRemoveTag?.(tag)}
            className="text-muted-foreground opacity-0 transition-opacity hover:text-rose-500 group-hover/tag:opacity-100"
            aria-label={`Remove ${tag}`}
          >
            <X className="w-2.5 h-2.5" />
          </button>
        </span>
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-primary transition-colors"
            title="Add Tag"
            aria-label="Add Tag"
          >
            <Plus className="w-3 h-3" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-0 bg-card border-border text-foreground" align="start">
          <Command className="bg-transparent">
            <CommandInput
              placeholder="Search or create tag..."
              value={query}
              onValueChange={setQuery}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && query.trim()) {
                  event.preventDefault();
                  addTag(query);
                }
              }}
            />
            <CommandList
              className="max-h-56 overscroll-contain"
              onWheel={(event) => event.stopPropagation()}
            >
              <CommandEmpty>{`Press Enter to create "${query.trim()}"`}</CommandEmpty>
              <CommandGroup heading="Available Tags">
                {availableTags.map((tag) => (
                  <CommandItem
                    key={tag}
                    value={tag}
                    onSelect={() => addTag(tag)}
                  >
                    <span className="flex-1">{tag}</span>
                    {onDeleteGlobalTag ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onDeleteGlobalTag(tag);
                        }}
                        className="text-muted-foreground hover:text-rose-500"
                        aria-label={`Delete ${tag}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

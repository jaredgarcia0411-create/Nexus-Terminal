'use client';

import { useMemo, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { TAG_TEXT_CLASS } from '@/components/trading/TradeTagEditor';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface ManageTagsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  globalTags: string[];
  onRenameTag: (from: string, to: string) => Promise<void>;
  onDeleteTag: (tagName: string) => void;
}

export default function ManageTagsDialog({
  open,
  onOpenChange,
  globalTags,
  onRenameTag,
  onDeleteTag,
}: ManageTagsDialogProps) {
  const sortedTags = useMemo(() => [...globalTags].sort((a, b) => a.localeCompare(b)), [globalTags]);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [renameFrom, setRenameFrom] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);

  const toggleSelected = (tag: string) => {
    setSelectedTags((current) => {
      const next = new Set(current);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const deleteTag = (tag: string) => {
    onDeleteTag(tag);
    setSelectedTags((current) => {
      const next = new Set(current);
      next.delete(tag);
      return next;
    });
  };

  const submitRename = async () => {
    if (!renameFrom || !renameValue.trim()) return;
    setRenaming(true);
    try {
      await onRenameTag(renameFrom, renameValue);
      setRenameFrom(null);
      setRenameValue('');
      toast.success('Tag renamed');
    } catch {
      toast.error('Failed to rename tag');
    } finally {
      setRenaming(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-card text-foreground sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Manage Tags</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {selectedTags.size > 0 ? (
            <div className="flex items-center justify-between rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2">
              <span className="text-xs text-rose-300">
                {selectedTags.size} selected
              </span>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  selectedTags.forEach((tag) => onDeleteTag(tag));
                  setSelectedTags(new Set());
                }}
                className="border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Delete selected
              </Button>
            </div>
          ) : null}

          {sortedTags.length === 0 ? (
            <div className="rounded-lg border border-border bg-accent px-3 py-6 text-center text-sm text-muted-foreground">
              No tags created yet.
            </div>
          ) : (
            <div className="max-h-[28rem] space-y-2 overflow-y-auto">
              {sortedTags.map((tag) => (
                <div key={tag} className="rounded-lg border border-border bg-accent px-3 py-2">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={selectedTags.has(tag)}
                      onChange={() => toggleSelected(tag)}
                      className="h-4 w-4 rounded border-border bg-card accent-primary"
                      aria-label={`Select ${tag}`}
                    />
                    <span className={`min-w-0 flex-1 truncate font-medium ${TAG_TEXT_CLASS}`}>{tag}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setRenameFrom(tag);
                        setRenameValue(tag);
                      }}
                      className="h-8 border-border bg-card px-2 text-muted-foreground hover:bg-card"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      <span className="sr-only">Rename</span>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => deleteTag(tag)}
                      className="h-8 border-rose-500/30 bg-rose-500/10 px-2 text-rose-300 hover:bg-rose-500/20"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span className="sr-only">Delete</span>
                    </Button>
                  </div>

                  {renameFrom === tag ? (
                    <div className="mt-3 flex items-end gap-2">
                      <div className="flex-1 space-y-1">
                        <Label htmlFor={`rename-${tag}`} className="text-xs text-muted-foreground">
                          Rename to
                        </Label>
                        <Input
                          id={`rename-${tag}`}
                          value={renameValue}
                          onChange={(event) => setRenameValue(event.target.value)}
                          className="h-8 border-border bg-card text-sm"
                        />
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        disabled={renaming || !renameValue.trim()}
                        onClick={() => void submitRename()}
                        className="border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                      >
                        {renaming ? 'Renaming...' : 'Rename'}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setRenameFrom(null);
                          setRenameValue('');
                        }}
                        className="border-border bg-card text-muted-foreground hover:bg-card"
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

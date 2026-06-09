'use client';

import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

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

interface ManageTeamTagsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamTags: string[];
  onCreateTag: (tagName: string) => void | Promise<void>;
  onDeleteTag: (tagName: string) => void | Promise<void>;
}

export default function ManageTeamTagsDialog({
  open,
  onOpenChange,
  teamTags,
  onCreateTag,
  onDeleteTag,
}: ManageTeamTagsDialogProps) {
  const sortedTags = useMemo(() => [...teamTags].sort((a, b) => a.localeCompare(b)), [teamTags]);
  const [newTag, setNewTag] = useState('');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const toggleSelected = (tag: string) => {
    setSelectedTags((current) => {
      const next = new Set(current);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const submitNewTag = async () => {
    const trimmed = newTag.trim();
    if (!trimmed || sortedTags.includes(trimmed)) return;

    setAdding(true);
    try {
      await onCreateTag(trimmed);
      setNewTag('');
    } finally {
      setAdding(false);
    }
  };

  const deleteTag = async (tag: string) => {
    await onDeleteTag(tag);
    setSelectedTags((current) => {
      const next = new Set(current);
      next.delete(tag);
      return next;
    });
  };

  const deleteSelected = async () => {
    setDeleting(true);
    try {
      for (const tag of selectedTags) {
        await onDeleteTag(tag);
      }
      setSelectedTags(new Set());
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-card text-foreground sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Manage Team Tags</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-end gap-2 rounded-lg border border-border bg-accent px-3 py-3">
            <div className="flex-1 space-y-1">
              <Label htmlFor="new-team-tag" className="text-xs text-muted-foreground">
                New tag
              </Label>
              <Input
                id="new-team-tag"
                value={newTag}
                onChange={(event) => setNewTag(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void submitNewTag();
                  }
                }}
                className="h-8 border-border bg-card text-sm"
              />
            </div>
            <Button
              type="button"
              size="sm"
              disabled={adding || !newTag.trim() || sortedTags.includes(newTag.trim())}
              onClick={() => void submitNewTag()}
              className="border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add
            </Button>
          </div>

          {selectedTags.size > 0 ? (
            <div className="flex items-center justify-between rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2">
              <span className="text-xs text-rose-300">
                {selectedTags.size} selected
              </span>
              <Button
                type="button"
                size="sm"
                disabled={deleting}
                onClick={() => void deleteSelected()}
                className="border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 disabled:opacity-40"
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Delete selected
              </Button>
            </div>
          ) : null}

          {sortedTags.length === 0 ? (
            <div className="rounded-lg border border-border bg-accent px-3 py-6 text-center text-sm text-muted-foreground">
              No team tags created yet.
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
                      onClick={() => void deleteTag(tag)}
                      className="h-8 border-rose-500/30 bg-rose-500/10 px-2 text-rose-300 hover:bg-rose-500/20"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span className="sr-only">Delete</span>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

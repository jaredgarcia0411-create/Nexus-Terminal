'use client';

import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SheetMember } from '@/hooks/use-sheets';

interface ShareSheetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: SheetMember[];
  ownerUserId: string;
  onAdd: (email: string, role: 'editor' | 'viewer') => Promise<void>;
  onChangeRole: (userId: string, role: 'editor' | 'viewer') => Promise<void>;
  onRemove: (userId: string) => Promise<void>;
}

export default function ShareSheetDialog({
  open,
  onOpenChange,
  members,
  ownerUserId,
  onAdd,
  onChangeRole,
  onRemove,
}: ShareSheetDialogProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEmail('');
    setRole('editor');
    setError(null);
    setSubmitting(false);
  }, [open]);

  const handleAdd = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setError('Email is required');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onAdd(trimmed, role);
      setEmail('');
    } catch (addError) {
      setError(addError instanceof Error
        ? addError.message
        : 'Could not add that person. Check the email and that they have signed in before.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-card text-foreground sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share Sheet</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>People with access</Label>
            <div className="space-y-1">
              {members.map((member) => {
                const isOwner = member.userId === ownerUserId;
                return (
                  <div
                    key={member.userId}
                    className="flex items-center justify-between gap-2 rounded-md border border-border bg-accent/40 px-2 py-1.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-foreground">
                        {member.name ?? member.email ?? member.userId}
                      </p>
                      {member.email ? (
                        <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                      ) : null}
                    </div>

                    {isOwner ? (
                      <span className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">Owner</span>
                    ) : (
                      <div className="flex items-center gap-1">
                        <select
                          value={member.role === 'viewer' ? 'viewer' : 'editor'}
                          onChange={(event) => {
                            void onChangeRole(member.userId, event.target.value as 'editor' | 'viewer');
                          }}
                          className="h-8 rounded-md border border-border bg-popover px-2 text-sm text-popover-foreground [color-scheme:dark]"
                        >
                          <option value="editor">editor</option>
                          <option value="viewer">viewer</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => void onRemove(member.userId)}
                          className="flex h-8 w-8 items-center justify-center rounded-md border border-rose-500/40 text-rose-400 transition-colors hover:bg-rose-500/10"
                          aria-label={`Remove ${member.email ?? member.userId}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="share-email">Invite by email</Label>
            <div className="flex items-center gap-2">
              <Input
                id="share-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.com"
                className="border-border bg-accent text-foreground"
              />
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as 'editor' | 'viewer')}
                className="h-9 rounded-md border border-border bg-popover px-2 text-sm text-popover-foreground [color-scheme:dark]"
              >
                <option value="editor">editor</option>
                <option value="viewer">viewer</option>
              </select>
            </div>
          </div>

          {error ? <p className="text-sm text-rose-400">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            className="bg-accent hover:bg-accent/80"
          >
            Done
          </Button>
          <Button
            type="button"
            disabled={submitting}
            onClick={() => void handleAdd()}
            className="border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40"
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

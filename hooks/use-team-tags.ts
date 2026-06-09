'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

function sortTags(tags: string[]) {
  return [...tags].sort((a, b) => a.localeCompare(b));
}

export function useTeamTags() {
  const [teamTags, setTeamTags] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/team-tags')
      .then((res) => (res.ok ? res.json() : { tags: [] }))
      .then((data: { tags?: string[] }) => {
        if (!cancelled) setTeamTags(sortTags(data.tags ?? []));
      })
      .catch(() => {
        if (!cancelled) setTeamTags([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const createTag = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;

    const res = await fetch('/api/team-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    });
    if (!res.ok) {
      toast.error('Failed to add team tag');
      throw new Error(`team tag create failed: ${res.status}`);
    }

    const data = (await res.json()) as { tag?: string };
    const tag = data.tag ?? trimmed;
    setTeamTags((current) => {
      if (current.includes(tag)) return current;
      return sortTags([...current, tag]);
    });
  }, []);

  const deleteTag = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;

    const res = await fetch('/api/team-tags', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    });
    if (!res.ok) {
      toast.error('Failed to delete team tag');
      throw new Error(`team tag delete failed: ${res.status}`);
    }

    setTeamTags((current) => current.filter((tag) => tag !== trimmed));
  }, []);

  return { teamTags, createTag, deleteTag };
}

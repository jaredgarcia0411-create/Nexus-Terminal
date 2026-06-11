// Generic localStorage-backed draft store, keyed by a namespace string. Each
// namespace holds a map of recordId -> draft. All access is wrapped because
// storage throws in private-browsing / quota situations.
export function readDrafts<T>(key: string): Record<string, T> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, T>) : {};
  } catch {
    return {};
  }
}

export function writeDrafts<T>(key: string, drafts: Record<string, T>): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(drafts));
  } catch {
    // Ignore storage failures (private browsing / quota).
  }
}

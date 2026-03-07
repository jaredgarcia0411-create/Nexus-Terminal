type TradeForBatchKey = {
  id: string;
  date: string;
  sortKey?: string;
  symbol?: string;
  netPnl?: number;
  pnl?: number;
  executionCount?: number;
  executions?: number;
};

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

export function createMigrationBatchKey(userId: string, trades: TradeForBatchKey[], tags: string[]) {
  const tradeDigest = [...trades]
    .map((trade) => {
      const pnl = trade.netPnl ?? trade.pnl ?? 0;
      const count = trade.executionCount ?? trade.executions ?? 0;
      return `${trade.id}|${trade.date}|${trade.sortKey ?? ''}|${trade.symbol ?? ''}|${pnl}|${count}`;
    })
    .sort()
    .join('~');

  const tagDigest = [...tags].map((tag) => tag.trim()).filter(Boolean).sort().join('~');
  const payload = `${tradeDigest}::${tagDigest}`;
  return `local-migration:${userId}:${hashString(payload)}`;
}

export function acquireMigrationLock(storage: StorageLike, key: string, nowMs: number, ttlMs: number) {
  const raw = storage.getItem(key);
  if (raw) {
    const expiresAt = Number(raw);
    if (Number.isFinite(expiresAt) && expiresAt > nowMs) {
      return false;
    }
  }

  storage.setItem(key, String(nowMs + ttlMs));
  return true;
}

export function releaseMigrationLock(storage: StorageLike, key: string) {
  storage.removeItem(key);
}

export function isDatabaseUnavailableError(error: unknown) {
  if (error instanceof Error && error.message === 'Database not configured') return true;

  if (typeof error === 'object' && error !== null) {
    const maybeStatus = (error as { status?: unknown }).status;
    const maybeMessage = (error as { message?: unknown }).message;
    if (maybeStatus === 503) return true;
    if (typeof maybeMessage === 'string' && maybeMessage === 'Database not configured') return true;
  }

  return false;
}

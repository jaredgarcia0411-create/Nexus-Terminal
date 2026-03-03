import { createClient, type Client } from '@libsql/client';

let client: Client | null = null;

export function getDb(): Client | null {
  if (!process.env.TURSO_DATABASE_URL) {
    return null;
  }

  if (!client) {
    client = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }

  return client;
}

export async function initDb() {
  const db = getDb();
  if (!db) return;

  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      picture TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      date TEXT NOT NULL,
      sort_key TEXT NOT NULL,
      symbol TEXT NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
      avg_entry_price REAL NOT NULL,
      avg_exit_price REAL NOT NULL,
      total_quantity REAL NOT NULL,
      pnl REAL NOT NULL,
      executions INTEGER NOT NULL DEFAULT 1,
      initial_risk REAL,
      commission REAL DEFAULT 0,
      fees REAL DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trade_tags (
      trade_id TEXT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      PRIMARY KEY (trade_id, tag)
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      UNIQUE(user_id, name)
    );

    CREATE TABLE IF NOT EXISTS schwab_tokens (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS broker_sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id),
      broker TEXT NOT NULL,
      account_number TEXT NOT NULL,
      sync_start TEXT NOT NULL,
      sync_end TEXT NOT NULL,
      trades_synced INTEGER NOT NULL DEFAULT 0,
      synced_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS token_refresh_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id),
      rotated INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS discord_user_links (
      user_id TEXT NOT NULL REFERENCES users(id),
      discord_user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      linked_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, discord_user_id)
    );

    CREATE TABLE IF NOT EXISTS price_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id),
      symbol TEXT NOT NULL,
      condition TEXT NOT NULL CHECK (condition IN ('above', 'below')),
      target_price REAL NOT NULL,
      triggered INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_trades_user_sort_key ON trades(user_id, sort_key);
    CREATE INDEX IF NOT EXISTS idx_trade_tags_trade_id ON trade_tags(trade_id);
    CREATE INDEX IF NOT EXISTS idx_tags_user_id ON tags(user_id);
  `);
}

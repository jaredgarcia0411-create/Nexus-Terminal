import { randomUUID } from 'node:crypto';

import { lt, sql } from 'drizzle-orm';

import { getDb } from './db.js';
import { marketSnapshots, realtimeQuotes } from './schema.js';
import type { QuoteUpdate, ScreenerUpdate } from './streamer.js';

const FLUSH_INTERVAL_MS = 1_000;
const UPSERT_BATCH_SIZE = 50;
const SCREENER_SNAPSHOT_TYPE = 'schwab_screener';

export class QuoteWriter {
  private readonly quoteBuffer = new Map<string, QuoteUpdate>();
  private readonly flushTimer: NodeJS.Timeout;
  private flushCount = 0;

  private gainers: ScreenerUpdate['items'] = [];
  private losers: ScreenerUpdate['items'] = [];

  constructor() {
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, FLUSH_INTERVAL_MS);
  }

  addQuote(quote: QuoteUpdate): void {
    if (!quote.symbol) {
      return;
    }

    const existing = this.quoteBuffer.get(quote.symbol);
    this.quoteBuffer.set(quote.symbol, {
      ...(existing ?? {}),
      ...quote,
      symbol: quote.symbol,
      assetType: quote.assetType ?? existing?.assetType ?? 'equity',
    });
  }

  async flush(): Promise<void> {
    if (this.quoteBuffer.size === 0) {
      return;
    }

    const db = getDb();
    const pendingQuotes = Array.from(this.quoteBuffer.values());
    this.quoteBuffer.clear();

    for (let index = 0; index < pendingQuotes.length; index += UPSERT_BATCH_SIZE) {
      const batch = pendingQuotes.slice(index, index + UPSERT_BATCH_SIZE);

      const rows = batch.map((quote) => ({
        symbol: quote.symbol,
        assetType: quote.assetType,
        lastPrice: quote.lastPrice,
        bidPrice: quote.bidPrice,
        askPrice: quote.askPrice,
        openPrice: quote.openPrice,
        highPrice: quote.highPrice,
        lowPrice: quote.lowPrice,
        closePrice: quote.closePrice,
        netChange: quote.netChange,
        netChangePercent: quote.netChangePercent,
        totalVolume: quote.totalVolume,
        quoteTimeMs: quote.quoteTimeMs,
        updatedAt: new Date(),
      }));

      await db
        .insert(realtimeQuotes)
        .values(rows)
        .onConflictDoUpdate({
          target: realtimeQuotes.symbol,
          set: {
            assetType: sql`excluded.asset_type`,
            lastPrice: sql`excluded.last_price`,
            bidPrice: sql`excluded.bid_price`,
            askPrice: sql`excluded.ask_price`,
            openPrice: sql`excluded.open_price`,
            highPrice: sql`excluded.high_price`,
            lowPrice: sql`excluded.low_price`,
            closePrice: sql`excluded.close_price`,
            netChange: sql`excluded.net_change`,
            netChangePercent: sql`excluded.net_change_percent`,
            totalVolume: sql`excluded.total_volume`,
            quoteTimeMs: sql`excluded.quote_time_ms`,
            updatedAt: sql`NOW()`,
          },
        });
    }

    this.flushCount++;
    if (this.flushCount % 60 === 0) {
      console.info(`[relay] wrote ${pendingQuotes.length} realtime quote rows (flush #${this.flushCount})`);
    }
  }

  async addScreenerData(screenerUpdate: ScreenerUpdate): Promise<void> {
    if (screenerUpdate.type === 'gainers') {
      this.gainers = screenerUpdate.items;
    } else {
      this.losers = screenerUpdate.items;
    }

    // Also buffer screener items into realtime_quotes
    for (const item of screenerUpdate.items) {
      this.addQuote({
        symbol: item.symbol,
        assetType: 'equity',
        lastPrice: item.lastPrice,
        netChange: item.netChange,
        netChangePercent: item.netChangePercent,
        totalVolume: item.totalVolume,
      });
    }

    const db = getDb();
    const snapshot = {
      gainers: this.gainers,
      losers: this.losers,
    };

    await db
      .insert(marketSnapshots)
      .values({
        id: randomUUID(),
        snapshotType: SCREENER_SNAPSHOT_TYPE,
        dataJson: snapshot,
        warning: null,
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      })
      .onConflictDoUpdate({
        target: marketSnapshots.snapshotType,
        set: {
          dataJson: snapshot,
          warning: null,
          fetchedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
  }

  stop(): void {
    clearInterval(this.flushTimer);
  }
}

export async function cleanupStaleQuotes(): Promise<void> {
  const db = getDb();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const result = await db
    .delete(realtimeQuotes)
    .where(lt(realtimeQuotes.updatedAt, oneHourAgo));

  const count = (result as { rowCount?: number }).rowCount ?? 0;
  if (count > 0) {
    console.info(`[relay] cleaned up ${count} stale quote rows`);
  }
}

import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { getDb } from './db.js';
import { marketSnapshots, realtimeQuotes } from './schema.js';
import type { QuoteUpdate, ScreenerUpdate } from './streamer.js';

const FLUSH_INTERVAL_MS = 1_000;
const UPSERT_BATCH_SIZE = 50;
const SCREENER_SNAPSHOT_TYPE = 'schwab_screener';

export class QuoteWriter {
  private readonly quoteBuffer = new Map<string, QuoteUpdate>();
  private readonly flushTimer: NodeJS.Timeout;

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

      await Promise.all(
        batch.map((quote) =>
          db
            .insert(realtimeQuotes)
            .values({
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
              exchangeId: quote.exchangeId,
              description: undefined,
              securityStatus: quote.securityStatus,
              quoteTimeMs: quote.quoteTimeMs,
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: realtimeQuotes.symbol,
              set: {
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
                exchangeId: quote.exchangeId,
                securityStatus: quote.securityStatus,
                quoteTimeMs: quote.quoteTimeMs,
                updatedAt: sql`NOW()`,
              },
            }),
        ),
      );
    }

    console.info(`[relay] wrote ${pendingQuotes.length} realtime quote rows`);
  }

  async addScreenerData(screenerUpdate: ScreenerUpdate): Promise<void> {
    if (screenerUpdate.type === 'gainers') {
      this.gainers = screenerUpdate.items;
    } else {
      this.losers = screenerUpdate.items;
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

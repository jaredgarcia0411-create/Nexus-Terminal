import type WebSocket from 'ws';
import type { QuoteUpdate, ScreenerUpdate } from './streamer.js';

/**
 * Manages WebSocket client connections and broadcasts quote data.
 *
 * Maintains an in-memory snapshot of all quotes so new clients
 * get the full picture immediately on connect, then receive
 * only incremental changes after that.
 */
export class QuoteBroadcaster {
  private readonly clients = new Set<WebSocket>();
  private readonly snapshot = new Map<string, QuoteUpdate>();
  private lastScreener: { gainers: ScreenerUpdate['items']; losers: ScreenerUpdate['items'] } = {
    gainers: [],
    losers: [],
  };

  get clientCount(): number {
    return this.clients.size;
  }

  /**
   * Add a new WebSocket client. Sends the current full snapshot
   * immediately so the client doesn't start with an empty screen.
   */
  addClient(ws: WebSocket): void {
    this.clients.add(ws);

    // Send full snapshot on connect
    const allQuotes = Array.from(this.snapshot.values());
    this.send(ws, { type: 'snapshot', data: allQuotes });

    // Send current screener data
    if (this.lastScreener.gainers.length > 0 || this.lastScreener.losers.length > 0) {
      this.send(ws, { type: 'screener', data: this.lastScreener });
    }

    ws.on('close', () => {
      this.clients.delete(ws);
    });

    ws.on('error', () => {
      this.clients.delete(ws);
    });
  }

  /**
   * Merge new quotes into the in-memory snapshot and broadcast
   * the incremental update to all connected clients.
   *
   * Uses the same COALESCE-style merge as QuoteWriter — only
   * overwrite fields that have a non-undefined value in the update.
   */
  broadcast(quotes: QuoteUpdate[]): void {
    for (const quote of quotes) {
      if (!quote.symbol) continue;

      const existing = this.snapshot.get(quote.symbol);
      this.snapshot.set(quote.symbol, {
        ...(existing ?? {}),
        ...quote,
        symbol: quote.symbol,
        assetType: quote.assetType ?? existing?.assetType ?? 'equity',
      });
    }

    const message = { type: 'quotes', data: quotes };
    for (const client of this.clients) {
      this.send(client, message);
    }
  }

  /**
   * Broadcast screener (gainers/losers) data to all clients.
   */
  broadcastScreener(update: ScreenerUpdate): void {
    if (update.type === 'gainers') {
      this.lastScreener.gainers = update.items;
    } else {
      this.lastScreener.losers = update.items;
    }

    const message = { type: 'screener', data: this.lastScreener };
    for (const client of this.clients) {
      this.send(client, message);
    }
  }

  /**
   * Close all client connections (used during shutdown).
   */
  closeAll(): void {
    for (const client of this.clients) {
      try {
        client.close(1001, 'server shutting down');
      } catch {
        // Ignore errors during shutdown
      }
    }
    this.clients.clear();
  }

  private send(ws: WebSocket, message: unknown): void {
    if (ws.readyState !== 1 /* WebSocket.OPEN */) return;
    try {
      ws.send(JSON.stringify(message));
    } catch {
      this.clients.delete(ws);
    }
  }
}

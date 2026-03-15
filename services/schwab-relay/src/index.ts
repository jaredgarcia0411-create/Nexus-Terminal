import 'dotenv/config';

import { getDb } from './db.js';
import { SchwabStreamer } from './streamer.js';
import { loadActiveTokens } from './tokens.js';
import { QuoteWriter } from './writer.js';

const TOKEN_CHECK_INTERVAL_MS = Number(process.env.TOKEN_CHECK_INTERVAL_MS ?? '300000');

let writer: QuoteWriter | null = null;
let streamer: SchwabStreamer | null = null;
let activeUserId: string | null = null;
let activeAccessToken: string | null = null;

function log(message: string): void {
  console.info(`[relay] ${new Date().toISOString()} ${message}`);
}

function stopStreamer(): void {
  if (!streamer) {
    return;
  }

  streamer.disconnect();
  streamer = null;
  activeAccessToken = null;
  activeUserId = null;
}

async function startStreamer(accessToken: string): Promise<void> {
  if (!writer) {
    writer = new QuoteWriter();
  }

  streamer = new SchwabStreamer({
    accessToken,
    onQuoteUpdate: (quotes) => {
      for (const quote of quotes) {
        writer?.addQuote(quote);
      }
    },
    onScreenerUpdate: (update) => {
      if (!writer) {
        return;
      }

      void writer.addScreenerData(update).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'unknown screener write error';
        log(`screener write failed: ${message}`);
      });
    },
    onError: (error) => {
      log(`stream error: ${error.message}`);
    },
    onDisconnect: () => {
      log('stream disconnected');
    },
  });

  await streamer.connect();
  log('stream connected');
}

async function syncTokens(): Promise<void> {
  const db = getDb();
  const active = await loadActiveTokens(db);

  if (!active) {
    if (streamer) {
      log('no active Schwab link found, stopping stream');
      stopStreamer();
    } else {
      log('no active Schwab link found, waiting');
    }
    return;
  }

  const shouldReconnect =
    active.userId !== activeUserId || active.tokens.accessToken !== activeAccessToken || !streamer;

  if (!shouldReconnect) {
    return;
  }

  if (streamer) {
    log('access token updated, reconnecting stream');
    stopStreamer();
  } else {
    log(`active Schwab link found for user ${active.userId}`);
  }

  activeUserId = active.userId;
  activeAccessToken = active.tokens.accessToken;
  await startStreamer(active.tokens.accessToken);
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  log(`received ${signal}, shutting down`);

  stopStreamer();

  if (writer) {
    await writer.flush();
    writer.stop();
    writer = null;
  }

  process.exit(0);
}

async function main(): Promise<void> {
  log('starting Schwab relay service');

  await syncTokens();

  setInterval(() => {
    void syncTokens().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'unknown token sync error';
      log(`token sync failed: ${message}`);
    });
  }, TOKEN_CHECK_INTERVAL_MS);

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown startup error';
  log(`fatal startup error: ${message}`);
  process.exit(1);
});

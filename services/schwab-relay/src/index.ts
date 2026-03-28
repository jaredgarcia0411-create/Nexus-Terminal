import 'dotenv/config';

import { createServer } from 'node:http';

import { getDb } from './db.js';
import { loadImportedTickers } from './imported-tickers.js';
import { SchwabStreamer } from './streamer.js';
import { loadActiveTokens } from './tokens.js';
import { QuoteWriter, cleanupStaleQuotes } from './writer.js';
import { WebSocketServer } from 'ws';
import { QuoteBroadcaster } from './broadcast.js';
import { validateRelayToken } from './ws-auth.js';

const TOKEN_CHECK_INTERVAL_MS = Number(process.env.TOKEN_CHECK_INTERVAL_MS ?? '60000');

let writer: QuoteWriter | null = null;
let streamer: SchwabStreamer | null = null;
let activeUserId: string | null = null;
let activeAccessToken: string | null = null;
let broadcaster: QuoteBroadcaster | null = null;

function log(message: string): void {
  console.info(`[relay] ${new Date().toISOString()} ${message}`);
}

const HEALTH_PORT = Number(process.env.HEALTH_PORT ?? '8080');

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

      // Broadcast to WebSocket clients (bypasses DB)
      broadcaster?.broadcast(quotes);
    },
    onScreenerUpdate: (update) => {
      if (!writer) {
        return;
      }

      void writer.addScreenerData(update).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'unknown screener write error';
        log(`screener write failed: ${message}`);
      });

      // Broadcast screener to WebSocket clients
      broadcaster?.broadcastScreener(update);

      // Dynamically subscribe screener symbols to LEVELONE_EQUITIES for richer data
      const symbols = update.items.map((item) => item.symbol);
      streamer?.addEquitySymbols(symbols);
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

  // Subscribe to tickers from imported Discord research reports
  try {
    const importedTickers = await loadImportedTickers();
    if (importedTickers.length > 0) {
      streamer.addEquitySymbols(importedTickers);
      log(`subscribed ${importedTickers.length} imported research tickers`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    log(`failed to load imported tickers (non-fatal): ${message}`);
  }
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

  const tokenChanged = active.tokens.accessToken !== activeAccessToken;
  const userChanged = active.userId !== activeUserId;
  const noStreamer = !streamer;

  if (userChanged || noStreamer) {
    if (streamer) {
      log('user changed, restarting stream');
      stopStreamer();
    } else {
      log(`active Schwab link found for user ${active.userId}`);
    }
    activeUserId = active.userId;
    activeAccessToken = active.tokens.accessToken;
    await startStreamer(active.tokens.accessToken);
    return;
  }

  if (tokenChanged) {
    const currentStreamer = streamer;
    if (!currentStreamer) {
      return;
    }

    log('access token rotated, updating streamer in place');
    activeAccessToken = active.tokens.accessToken;
    currentStreamer.updateAccessToken(active.tokens.accessToken);
    if (!currentStreamer.isConnected()) {
      log('streamer not connected after token update, forcing reconnect');
      stopStreamer();
      await startStreamer(active.tokens.accessToken);
    }
  }
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  log(`received ${signal}, shutting down`);

  stopStreamer();

  if (writer) {
    await writer.flush();
    writer.stop();
    writer = null;
  }

  broadcaster?.closeAll();

  process.exit(0);
}

async function main(): Promise<void> {
  log('starting Schwab relay service');

  const healthServer = createServer((req, res) => {
    if (req.url === '/health') {
      const status = {
        ok: true,
        connected: streamer?.isConnected() ?? false,
        activeUser: activeUserId !== null,
        wsClients: broadcaster?.clientCount ?? 0,
        uptime: process.uptime(),
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  // --- WebSocket server for direct browser connections ---
  broadcaster = new QuoteBroadcaster();
  const wss = new WebSocketServer({ noServer: true });

  healthServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '', `http://${req.headers.host}`);

    // Only accept WebSocket upgrades on /ws path
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    // Validate auth token from query string
    const token = url.searchParams.get('token');
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const result = validateRelayToken(token);
    if (!result.valid) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      broadcaster!.addClient(ws);
      log(`ws client connected (user=${result.userId}, clients=${broadcaster!.clientCount})`);

      ws.on('close', () => {
        log(`ws client disconnected (clients=${broadcaster!.clientCount})`);
      });
    });
  });

  healthServer.listen(HEALTH_PORT, () => {
    log(`health check listening on :${HEALTH_PORT}`);
  });

  await syncTokens();

  setInterval(() => {
    void syncTokens().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'unknown token sync error';
      log(`token sync failed: ${message}`);
    });
  }, TOKEN_CHECK_INTERVAL_MS);

  setInterval(() => {
    void cleanupStaleQuotes().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'unknown cleanup error';
      log(`stale quote cleanup failed: ${message}`);
    });
  }, 60 * 60 * 1000);

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

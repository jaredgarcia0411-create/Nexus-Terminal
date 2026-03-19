'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RelayMessage, RelayQuoteUpdate, RelayScreenerData } from '@/lib/relay-types';

type UseRelaySocketOptions = {
  /** Whether to attempt connecting. Set to false to disable. */
  enabled: boolean;
  /** Called once on connect with the full quote snapshot. */
  onSnapshot: (quotes: RelayQuoteUpdate[]) => void;
  /** Called on each incremental quote update from Schwab. */
  onQuotes: (quotes: RelayQuoteUpdate[]) => void;
  /** Called when screener data updates (full gainers + losers). */
  onScreener: (data: RelayScreenerData) => void;
};

type UseRelaySocketReturn = {
  /** Whether the WebSocket is currently open and receiving data. */
  connected: boolean;
  /** True after 3 failed reconnect attempts. Signals the caller to enable SSE fallback. */
  fallbackToSSE: boolean;
};

const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_BASE_DELAY_MS = 2_000;
const KEEPALIVE_INTERVAL_MS = 30_000;

/**
 * Hook that connects to the Schwab relay WebSocket for real-time quotes.
 *
 * Flow:
 * 1. Fetch a short-lived token from GET /api/relay-token
 * 2. Open WebSocket to the relay's /ws endpoint with the token
 * 3. Receive snapshot (full state), then incremental quotes + screener updates
 * 4. On disconnect: retry up to 3 times with exponential backoff
 * 5. After 3 failures: set fallbackToSSE = true so the caller can switch to SSE
 *
 * The token is only valid for 60 seconds (handshake only). Once connected,
 * the WebSocket stays open without re-authentication.
 */
export function useRelaySocket(options: UseRelaySocketOptions): UseRelaySocketReturn {
  const [connected, setConnected] = useState(false);
  const [fallbackToSSE, setFallbackToSSE] = useState(false);

  const onSnapshotRef = useRef(options.onSnapshot);
  const onQuotesRef = useRef(options.onQuotes);
  const onScreenerRef = useRef(options.onScreener);

  useEffect(() => {
    onSnapshotRef.current = options.onSnapshot;
    onQuotesRef.current = options.onQuotes;
    onScreenerRef.current = options.onScreener;
  }, [options.onSnapshot, options.onQuotes, options.onScreener]);

  const connect = useCallback(async () => {
    try {
      const res = await fetch('/api/relay-token');
      if (!res.ok) {
        return null;
      }

      const { token, wsUrl } = (await res.json()) as { token: string; wsUrl: string };
      const ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`);
      return ws;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!options.enabled) {
      return;
    }

    let ws: WebSocket | null = null;
    let reconnectAttempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
    let disposed = false;

    function cleanup() {
      if (keepaliveTimer) {
        clearInterval(keepaliveTimer);
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }

      keepaliveTimer = null;
      reconnectTimer = null;

      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
        ws = null;
      }
    }

    function scheduleReconnect() {
      if (disposed) return;

      reconnectAttempts += 1;
      if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        setFallbackToSSE(true);
        setConnected(false);
        return;
      }

      const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempts - 1);
      reconnectTimer = setTimeout(() => {
        if (disposed) return;
        void startConnection();
      }, delay);
    }

    async function startConnection() {
      if (disposed) return;

      cleanup();

      ws = await connect();

      if (!ws) {
        setFallbackToSSE(true);
        setConnected(false);
        return;
      }

      ws.onopen = () => {
        if (disposed) return;

        reconnectAttempts = 0;
        setConnected(true);
        setFallbackToSSE(false);

        keepaliveTimer = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, KEEPALIVE_INTERVAL_MS);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data as string) as RelayMessage;
          switch (message.type) {
            case 'snapshot':
              onSnapshotRef.current(message.data);
              break;
            case 'quotes':
              onQuotesRef.current(message.data);
              break;
            case 'screener':
              onScreenerRef.current(message.data);
              break;
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        setConnected(false);
        if (keepaliveTimer) {
          clearInterval(keepaliveTimer);
          keepaliveTimer = null;
        }
        scheduleReconnect();
      };

      ws.onerror = () => {
        // onclose will fire after onerror — reconnect logic is there
      };
    }

    void startConnection();

    return () => {
      disposed = true;
      cleanup();
      setConnected(false);
      setFallbackToSSE(false);
    };
  }, [options.enabled, connect]);

  return { connected, fallbackToSSE };
}

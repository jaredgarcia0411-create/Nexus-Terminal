import WebSocket from 'ws';

export type QuoteUpdate = {
  symbol: string;
  assetType: string;
  lastPrice?: number;
  bidPrice?: number;
  askPrice?: number;
  openPrice?: number;
  highPrice?: number;
  lowPrice?: number;
  closePrice?: number;
  netChange?: number;
  netChangePercent?: number;
  totalVolume?: number;
  exchangeId?: string;
  securityStatus?: string;
  quoteTimeMs?: number;
};

export type ScreenerUpdate = {
  type: 'gainers' | 'losers';
  items: Array<{
    symbol: string;
    lastPrice: number;
    netChange: number;
    netChangePercent: number;
    totalVolume: number;
  }>;
};

type StreamerConfig = {
  accessToken: string;
  onQuoteUpdate: (quotes: QuoteUpdate[]) => void;
  onScreenerUpdate: (data: ScreenerUpdate) => void;
  onError: (error: Error) => void;
  onDisconnect: () => void;
};

type FieldMap = Record<number, keyof QuoteUpdate>;

type StreamerPreferenceResponse = {
  streamerInfo?: Array<{
    streamerSocketUrl?: string;
    schwabClientCustomerId?: string;
    schwabClientCorrelId?: string;
    schwabClientChannel?: string;
    schwabClientFunctionId?: string;
  }>;
  streamerSocketUrl?: string;
};

const EQUITY_FIELDS: FieldMap = {
  0: 'symbol',
  1: 'bidPrice',
  2: 'askPrice',
  3: 'lastPrice',
  8: 'totalVolume',
  10: 'highPrice',
  11: 'lowPrice',
  12: 'closePrice',
  17: 'openPrice',
  18: 'netChange',
  28: 'netChangePercent',
};

function toStringData(data: WebSocket.RawData): string {
  if (typeof data === 'string') {
    return data;
  }

  if (data instanceof Buffer) {
    return data.toString('utf8');
  }

  if (Array.isArray(data)) {
    return data
      .map((chunk) => Buffer.from(chunk as unknown as Uint8Array).toString('utf8'))
      .join('');
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8');
  }

  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
}

function parseList(envName: string): string[] {
  const raw = process.env[envName] ?? '';
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toRequestId(): string {
  return Math.floor(Math.random() * 1_000_000).toString();
}

export class SchwabStreamer {
  private readonly accessToken: string;
  private readonly onQuoteUpdate: StreamerConfig['onQuoteUpdate'];
  private readonly onScreenerUpdate: StreamerConfig['onScreenerUpdate'];
  private readonly onError: StreamerConfig['onError'];
  private readonly onDisconnect: StreamerConfig['onDisconnect'];

  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private manualDisconnect = false;
  private connected = false;
  private subscribed = false;
  private reconnectAttempts = 0;
  private readonly subscribedEquities = new Set<string>();
  private schwabClientCustomerId: string | null = null;
  private schwabClientCorrelId: string | null = null;

  constructor(config: StreamerConfig) {
    this.accessToken = config.accessToken;
    this.onQuoteUpdate = config.onQuoteUpdate;
    this.onScreenerUpdate = config.onScreenerUpdate;
    this.onError = config.onError;
    this.onDisconnect = config.onDisconnect;
  }

  async connect(): Promise<void> {
    this.manualDisconnect = false;
    this.clearReconnectTimer();

    try {
      const preference = await this.fetchPreference();
      const info = preference.streamerInfo?.[0];
      const socketUrl = info?.streamerSocketUrl ?? preference.streamerSocketUrl;

      if (
        !socketUrl ||
        !info?.schwabClientCustomerId ||
        !info?.schwabClientCorrelId ||
        !info?.schwabClientChannel ||
        !info?.schwabClientFunctionId
      ) {
        throw new Error('Schwab user preferences missing required streaming fields');
      }

      this.ws = new WebSocket(socketUrl);

      const customerId = info.schwabClientCustomerId;
      const correlId = info.schwabClientCorrelId;
      const channel = info.schwabClientChannel;
      const functionId = info.schwabClientFunctionId;

      // Store for use in subscribe() and addEquitySymbols()
      this.schwabClientCustomerId = customerId;
      this.schwabClientCorrelId = correlId;

      this.ws.on('open', () => {
        this.connected = true;
        this.reconnectAttempts = 0;
        this.sendLogin(customerId, correlId, channel, functionId);
      });

      this.ws.on('message', (raw: WebSocket.RawData) => {
        this.handleMessage(raw);
      });

      this.ws.on('error', (error: Error) => {
        this.onError(error instanceof Error ? error : new Error('Schwab WebSocket error'));
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        const reasonStr = reason.toString('utf8') || '(no reason)';
        console.info(`[relay] WebSocket closed: code=${code} reason=${reasonStr}`);
        this.connected = false;
        this.subscribed = false;
        this.subscribedEquities.clear();
        this.onDisconnect();

        if (!this.manualDisconnect) {
          this.scheduleReconnect();
        }
      });
    } catch (error) {
      this.onError(error instanceof Error ? error : new Error('Failed to connect Schwab streamer'));
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.manualDisconnect = true;
    this.clearReconnectTimer();

    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }

    this.connected = false;
    this.subscribed = false;
    this.subscribedEquities.clear();
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.connected;
  }

  addEquitySymbols(symbols: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.subscribed) {
      return;
    }

    const newSymbols = symbols.filter((s) => !this.subscribedEquities.has(s));
    if (newSymbols.length === 0) {
      return;
    }

    for (const sym of newSymbols) {
      this.subscribedEquities.add(sym);
    }

    this.sendMessage({
      requests: [
        {
          service: 'LEVELONE_EQUITIES',
          command: 'ADD',
          requestid: toRequestId(),
          SchwabClientCustomerId: this.schwabClientCustomerId,
          SchwabClientCorrelId: this.schwabClientCorrelId,
          parameters: {
            keys: newSymbols.join(','),
            fields: '0,1,2,3,8,10,11,12,17,18,28',
          },
        },
      ],
    });

    console.info(`[relay] dynamically subscribed ${newSymbols.length} new equity symbols`);
  }

  private async fetchPreference(): Promise<StreamerPreferenceResponse> {
    const response = await fetch('https://api.schwabapi.com/trader/v1/userPreference', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '(no body)');
      throw new Error(`Failed to load Schwab user preference (${response.status}): ${body}`);
    }

    return (await response.json()) as StreamerPreferenceResponse;
  }

  private sendLogin(
    customerId: string,
    correlId: string,
    channel: string,
    functionId: string,
  ): void {
    this.sendMessage({
      requests: [
        {
          service: 'ADMIN',
          command: 'LOGIN',
          requestid: '1',
          SchwabClientCustomerId: customerId,
          SchwabClientCorrelId: correlId,
          parameters: {
            Authorization: this.accessToken,
            SchwabClientChannel: channel,
            SchwabClientFunctionId: functionId,
          },
        },
      ],
    });
  }

  private subscribe(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.subscribed) {
      return;
    }

    const equities = parseList('TRACK_EQUITIES');
    for (const sym of equities) {
      this.subscribedEquities.add(sym);
    }
    const requests: Array<Record<string, unknown>> = [];

    if (equities.length > 0) {
      requests.push({
        service: 'LEVELONE_EQUITIES',
        command: 'SUBS',
        requestid: toRequestId(),
        SchwabClientCustomerId: this.schwabClientCustomerId,
        SchwabClientCorrelId: this.schwabClientCorrelId,
        parameters: {
          keys: equities.join(','),
          fields: '0,1,2,3,8,10,11,12,17,18,28',
        },
      });
    }

    requests.push({
      service: 'SCREENER_EQUITY',
      command: 'SUBS',
      requestid: toRequestId(),
      SchwabClientCustomerId: this.schwabClientCustomerId,
      SchwabClientCorrelId: this.schwabClientCorrelId,
      parameters: {
        keys: '$SPX.X_PERCENT_CHANGE_UP_0,$SPX.X_PERCENT_CHANGE_DOWN_0',
        fields: '0,1,2,3,4',
      },
    });

    this.sendMessage({ requests });
    this.subscribed = true;
  }

  private handleMessage(rawData: WebSocket.RawData): void {
    try {
      const parsed = JSON.parse(toStringData(rawData)) as {
        response?: Array<{ service?: string; command?: string; content?: unknown }>;
        notify?: Array<{ heartbeat?: string }>;
        data?: Array<{ service?: string; timestamp?: number; content?: Array<Record<string, unknown>> }>;
      };

      if (Array.isArray(parsed.notify) && parsed.notify.length > 0) {
        return;
      }

      if (Array.isArray(parsed.response)) {
        for (const entry of parsed.response) {
          const service = (entry as { service?: string }).service;
          const command = (entry as { command?: string }).command;
          const content = (entry as { content?: { code?: number; msg?: string } }).content;

          if (service === 'ADMIN' && command === 'LOGIN') {
            if (content?.code === 0) {
              console.log('[relay] LOGIN successful, subscribing...');
              this.subscribe();
            } else {
              console.error(`[relay] LOGIN failed: code=${content?.code} msg=${content?.msg}`);
              this.onError(new Error(`Schwab LOGIN failed: ${content?.msg ?? `code ${content?.code}`}`));
              this.disconnect();
            }
          } else {
            // Log all non-LOGIN responses (subscription confirmations/errors)
            console.info(`[relay] response: service=${service} command=${command} code=${content?.code} msg=${content?.msg}`);
          }
        }
      }

      if (!Array.isArray(parsed.data)) {
        return;
      }

      for (const entry of parsed.data) {
        if (!entry.service || !Array.isArray(entry.content)) {
          continue;
        }

        if (entry.service === 'SCREENER_EQUITY') {
          this.handleScreenerData(entry.content);
          continue;
        }

        const quotes = this.mapQuoteData(entry.service, entry.timestamp, entry.content);
        if (quotes.length > 0) {
          this.onQuoteUpdate(quotes);
        }
      }
    } catch (error) {
      this.onError(error instanceof Error ? error : new Error('Failed to parse Schwab stream message'));
    }
  }

  private mapQuoteData(
    service: string,
    timestamp: number | undefined,
    content: Array<Record<string, unknown>>,
  ): QuoteUpdate[] {
    if (service !== 'LEVELONE_EQUITIES') {
      return [];
    }

    return content
      .map((item) => {
        const quote: Partial<QuoteUpdate> = {
          assetType: 'equity',
          quoteTimeMs: toNumber(timestamp),
        };

        for (const [fieldNumberRaw, fieldName] of Object.entries(EQUITY_FIELDS)) {
          const value = item[fieldNumberRaw];
          if (fieldName === 'symbol') {
            if (typeof value === 'string' && value.length > 0) {
              quote.symbol = value;
            }
            continue;
          }

          const numericValue = toNumber(value);
          if (numericValue !== undefined) {
            (quote as Record<string, number | string | undefined>)[fieldName] = numericValue;
          }
        }

        if (!quote.symbol) {
          const fallbackSymbol = typeof item.key === 'string' ? item.key : undefined;
          if (fallbackSymbol) {
            quote.symbol = fallbackSymbol;
          }
        }

        return quote as QuoteUpdate;
      })
      .filter((quote) => typeof quote.symbol === 'string' && quote.symbol.length > 0);
  }

  private handleScreenerData(content: Array<Record<string, unknown>>): void {
    if (content.length === 0) {
      return;
    }

    const firstKey = typeof content[0].key === 'string' ? content[0].key : '';
    const type: ScreenerUpdate['type'] = firstKey.includes('DOWN') ? 'losers' : 'gainers';

    const items = content
      .map((item) => {
        const symbol =
          (typeof item['0'] === 'string' ? item['0'] : undefined) ??
          (typeof item.key === 'string' ? item.key : undefined);
        const lastPrice = toNumber(item['1']);
        const netChange = toNumber(item['2']);
        const netChangePercent = toNumber(item['3']);
        const totalVolume = toNumber(item['4']);

        if (
          !symbol ||
          lastPrice === undefined ||
          netChange === undefined ||
          netChangePercent === undefined ||
          totalVolume === undefined
        ) {
          return null;
        }

        return {
          symbol,
          lastPrice,
          netChange,
          netChangePercent,
          totalVolume,
        };
      })
      .filter((value): value is ScreenerUpdate['items'][number] => value !== null);

    this.onScreenerUpdate({ type, items });
  }

  private sendMessage(payload: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.ws.send(JSON.stringify(payload));
  }

  private scheduleReconnect(): void {
    if (this.manualDisconnect || this.reconnectTimer) {
      return;
    }

    const baseDelay = 5_000;
    const maxDelay = 5 * 60 * 1000;
    const delay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempts), maxDelay);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) {
      return;
    }

    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}

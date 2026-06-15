import { ClusterCandle } from "../types";

export type WsMessageType = "update" | "close" | "open" | "ok" | "error";

export interface WsMessage {
  type: WsMessageType;
  action?: string;
  symbol?: string;
  market?: string;
  tf?: string;
  compression?: number;
  candle?: any;
  candle_time?: number;
  error?: { code: string; message: string };
}

interface BackendCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  delta: number;
  cells: Array<{
    price: number;
    bid: number;
    ask: number;
    volume: number;
    isPoc: boolean;
    isBuyImbalance: boolean;
    isSellImbalance: boolean;
  }>;
}

function mapBackendCandle(bc: BackendCandle): ClusterCandle {
  let pocPrice = bc.open;
  let maxVol = 0;
  let vah = bc.high;
  let val = bc.low;

  for (const cell of bc.cells) {
    if (cell.volume > maxVol) {
      maxVol = cell.volume;
      pocPrice = cell.price;
    }
  }

  const sortedByVol = [...bc.cells].sort((a, b) => b.volume - a.volume);
  const targetVol = bc.volume * 0.7;
  let runningVol = 0;
  const vaPrices: number[] = [];
  for (const c of sortedByVol) {
    runningVol += c.volume;
    vaPrices.push(c.price);
    if (runningVol >= targetVol) break;
  }
  if (vaPrices.length > 0) {
    val = Math.min(...vaPrices);
    vah = Math.max(...vaPrices);
  }

  return {
    timestamp: bc.time * 1000,
    open: bc.open,
    high: bc.high,
    low: bc.low,
    close: bc.close,
    volume: bc.volume,
    delta: bc.delta,
    pocPrice,
    cells: bc.cells.map(c => ({
      price: c.price,
      bid: c.bid,
      ask: c.ask,
      volume: c.volume,
      isPoc: c.isPoc,
      isBuyImbalance: c.isBuyImbalance,
      isSellImbalance: c.isSellImbalance,
    })),
    vah,
    val,
  };
}

export interface WsClientConfig {
  url: string;
  onCandleUpdate?: (msg: WsMessage, candle: ClusterCandle) => void;
  onCandleClose?: (msg: WsMessage, candle: ClusterCandle) => void;
  onCandleOpen?: (msg: WsMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (err: Event) => void;
}

export class WsClient {
  private ws: WebSocket | null = null;
  private config: WsClientConfig;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 10000;
  private isUnmounting = false;
  private subscriptions: Array<{ symbol: string; market: string; tf: string; compression: number }> = [];

  constructor(config: WsClientConfig) {
    this.config = config;
  }

  connect() {
    if (this.isUnmounting) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const ws = new WebSocket(this.config.url);
    this.ws = ws;

    ws.onopen = () => {
      if (this.isUnmounting) { this.cleanClose(ws); return; }
      console.log("[WS Client] Connected to", this.config.url);
      this.reconnectDelay = 1000;
      this.config.onConnect?.();
      for (const sub of this.subscriptions) {
        this.sendSubscribe(sub);
      }
    };

    ws.onmessage = (event) => {
      if (this.isUnmounting) return;
      const lines = event.data.split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg: WsMessage = JSON.parse(line);
          this.handleMessage(msg);
        } catch (e) {
          console.error("[WS Client] Parse error:", e);
        }
      }
    };

    ws.onerror = (err) => {
      if (this.isUnmounting) return;
      console.error("[WS Client] Error:", err);
      this.config.onError?.(err);
    };

    ws.onclose = (ev) => {
      if (this.isUnmounting) return;
      console.log("[WS Client] Disconnected, code:", ev.code);
      this.ws = null;
      this.config.onDisconnect?.();
      // Reconnect on any unexpected close (1005, 1006, network drop)
      this.scheduleReconnect();
    };
  }

  private cleanClose(ws: WebSocket) {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    ws.close();
  }

  private handleMessage(msg: WsMessage) {
    switch (msg.type) {
      case "update":
        if (msg.candle) {
          this.config.onCandleUpdate?.(msg, mapBackendCandle(msg.candle));
        }
        break;
      case "close":
        if (msg.candle) {
          this.config.onCandleClose?.(msg, mapBackendCandle(msg.candle));
        }
        break;
      case "open":
        this.config.onCandleOpen?.(msg);
        break;
      case "ok":
        console.log("[WS Client] Subscribed:", msg.action, msg.symbol, msg.market, msg.tf, msg.compression);
        break;
      case "error":
        console.error("[WS Client] Server error:", msg.error);
        break;
    }
  }

  subscribe(symbol: string, market: string, tf: string, compression: number) {
    const exists = this.subscriptions.some(
      s => s.symbol === symbol && s.market === market && s.tf === tf && s.compression === compression
    );
    if (!exists) {
      this.subscriptions.push({ symbol, market, tf, compression });
    }
    this.sendSubscribe({ symbol, market, tf, compression });
  }

  unsubscribe(symbol: string, market: string, tf: string, compression: number) {
    this.subscriptions = this.subscriptions.filter(
      s => !(s.symbol === symbol && s.market === market && s.tf === tf && s.compression === compression)
    );
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: "unsubscribe", symbol, market, tf, compression }));
    }
  }

  private sendSubscribe(sub: { symbol: string; market: string; tf: string; compression: number }) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: "subscribe", ...sub }));
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (this.isUnmounting) return;
      console.log(`[WS Client] Reconnecting in ${this.reconnectDelay}ms...`);
      this.connect();
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    }, this.reconnectDelay);
  }

  disconnect() {
    this.isUnmounting = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      if (this.ws.readyState === WebSocket.CONNECTING) {
        // Socket still connecting — clean close without triggering handlers
        this.cleanClose(this.ws);
      } else {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        this.ws.close();
      }
      this.ws = null;
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

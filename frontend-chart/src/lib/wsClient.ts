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
  private destroyed = false;
  private activeSub: { symbol: string; market: string; tf: string; compression: number } | null = null;
  private pendingSub: { symbol: string; market: string; tf: string; compression: number } | null = null;

  constructor(config: WsClientConfig) {
    this.config = config;
  }

  connect() {
    if (this.destroyed) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const ws = new WebSocket(this.config.url);
    this.ws = ws;

    ws.onopen = () => {
      if (this.destroyed) { ws.close(); return; }
      console.log("[WS] Connected to", this.config.url);
      this.reconnectDelay = 1000;
      this.config.onConnect?.();
      // Send pending or active subscription
      const sub = this.pendingSub || this.activeSub;
      if (sub) {
        this.sendSubscribe(sub);
      }
    };

    ws.onmessage = (event) => {
      if (this.destroyed) return;
      const lines = event.data.split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg: WsMessage = JSON.parse(line);
          if (msg.type === "update" || msg.type === "close") {
            console.debug("[WS]", msg.type, msg.candle?.time);
          }
          this.handleMessage(msg);
        } catch (e) {
          console.error("[WS] Parse error:", e);
        }
      }
    };

    ws.onerror = (err) => {
      if (this.destroyed) return;
      console.error("[WS] Error:", err);
      this.config.onError?.(err);
    };

    ws.onclose = (ev) => {
      if (this.destroyed) return;
      console.log("[WS] Disconnected, code:", ev.code);
      this.ws = null;
      this.config.onDisconnect?.();
      this.scheduleReconnect();
    };
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
        console.log("[WS] Subscribed:", msg.action, msg.symbol, msg.market, msg.tf, msg.compression);
        break;
      case "error":
        console.error("[WS] Server error:", msg.error);
        break;
    }
  }

  subscribe(symbol: string, market: string, tf: string, compression: number) {
    const sub = { symbol, market, tf, compression };
    this.activeSub = sub;

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscribe(sub);
    } else {
      // Buffer — will be sent on onopen
      this.pendingSub = sub;
    }
  }

  private sendSubscribe(sub: { symbol: string; market: string; tf: string; compression: number }) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const msg = JSON.stringify({ action: "subscribe", ...sub });
      console.debug("[WS] >>>", msg);
      this.ws.send(msg);
    }
  }

  private scheduleReconnect() {
    if (this.destroyed) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (this.destroyed) return;
      console.log(`[WS] Reconnecting in ${this.reconnectDelay}ms...`);
      this.connect();
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    }, this.reconnectDelay);
  }

  destroy() {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      const ws = this.ws;
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      this.ws = null;
      ws.close();
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

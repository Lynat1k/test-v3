# Phase 6: Engine Adaptation — Real Data + Performance + Interactivity

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adapt the existing ClusterChart.tsx engine from mock/direct-Binance data to the real PROCLUSTER backend (REST + WS hub), add FPS counter, scroll-back history loading, and verify all interactive features work end-to-end.

**Architecture:** Replace direct Binance WebSocket connections in App.tsx with the backend WS hub protocol (subscribe/update/close/open). Fix api.ts REST endpoint from `/api/candles` (backend contract). Add scroll-triggered history loading via `before=` param. Add a dev FPS counter overlay. The engine itself (ClusterChart.tsx) needs minimal changes — it already has zoom, SHIFT/CTRL wheel, Auto mode, palettes, drawing tools, and diagonal imbalance.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind 4, Canvas 2D, WebSocket (gorilla/websocket on backend)

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `frontend-chart/src/lib/api.ts` | Modify | Fix REST endpoint, add `before` param, add `compression` param |
| `frontend-chart/src/App.tsx` | Modify | Replace Binance WS with backend WS hub, add scroll-back loading |
| `frontend-chart/src/components/ClusterChart.tsx` | Modify | Add FPS counter, add `onLoadMore` callback prop, add `onWsUpdate` callback prop |
| `frontend-chart/src/types.ts` | Modify | Add `onLoadMore` and `onWsUpdate` to ClusterChart props if needed |
| `frontend-chart/src/lib/wsClient.ts` | Create | Backend WS hub client (connect, subscribe, handle update/close/open) |

---

## Task 1: Fix REST API endpoint and add scroll-back params

**Covers:** §3 (REST loading), §9 (compression)

**Files:**
- Modify: `frontend-chart/src/lib/api.ts`

- [ ] **Step 1: Update api.ts to match backend contract**

The backend endpoint is `GET /api/candles?symbol=&market=&tf=&compression=&before=&limit=` returning `{ok: true, data: {candles: [...], history_limited: bool}}`.

```typescript
import { ClusterCandle } from "../types";

export interface GetClusterCandlesParams {
  symbol: string;
  market: string;      // "futures" | "spot"
  tf: string;          // timeframe: "1m","5m","15m","30m","1h","4h"
  compression: number; // actual compression ticks (e.g. 25, 50, 75...)
  before?: number;     // unix seconds — for scroll-back loading
  limit?: number;      // default 700, max 2000
}

export interface CandlesResponse {
  candles: ClusterCandle[];
  historyLimited: boolean;
}

export async function getClusterCandles(
  params: GetClusterCandlesParams
): Promise<CandlesResponse> {
  const apiBase = (import.meta as any).env?.VITE_API_BASE || "";

  const queryParams = new URLSearchParams({
    symbol: params.symbol,
    market: params.market,
    tf: params.tf,
    compression: String(params.compression),
  });

  if (params.before) {
    queryParams.set("before", String(params.before));
  }
  if (params.limit) {
    queryParams.set("limit", String(params.limit));
  }

  const url = `${apiBase}/api/candles?${queryParams.toString()}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch candles: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  if (!json.ok) {
    throw new Error(json.error?.message || "API error");
  }

  return json.data as CandlesResponse;
}
```

- [ ] **Step 2: Verify build compiles**

Run: `npm run lint` in `frontend-chart/`
Expected: No type errors (existing callers will break — fixed in Task 3)

---

## Task 2: Create backend WS hub client

**Covers:** §8 (realtime WS), §8 (reconnect)

**Files:**
- Create: `frontend-chart/src/lib/wsClient.ts`

- [ ] **Step 1: Create wsClient.ts**

```typescript
import { ClusterCandle } from "../types";

export type WsMessageType = "update" | "close" | "open" | "ok" | "error";

export interface WsMessage {
  type: WsMessageType;
  action?: string;
  symbol?: string;
  market?: string;
  tf?: string;
  compression?: number;
  candle?: ClusterCandle;
  candle_time?: number;
  error?: { code: string; message: string };
}

export interface WsClientConfig {
  url: string;
  onCandleUpdate?: (msg: WsMessage) => void;
  onCandleClose?: (msg: WsMessage) => void;
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
  private maxReconnectDelay = 30000;
  private shouldReconnect = true;
  private subscriptions: Array<{ symbol: string; market: string; tf: string; compression: number }> = [];

  constructor(config: WsClientConfig) {
    this.config = config;
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.ws = new WebSocket(this.config.url);

    this.ws.onopen = () => {
      console.log("[WS Client] Connected to", this.config.url);
      this.reconnectDelay = 1000;
      this.config.onConnect?.();
      // Re-subscribe to all previous subscriptions
      for (const sub of this.subscriptions) {
        this.sendSubscribe(sub);
      }
    };

    this.ws.onmessage = (event) => {
      // Backend may batch multiple JSON messages separated by \n
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

    this.ws.onerror = (err) => {
      console.error("[WS Client] Error:", err);
      this.config.onError?.(err);
    };

    this.ws.onclose = () => {
      console.log("[WS Client] Disconnected");
      this.config.onDisconnect?.();
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    };
  }

  private handleMessage(msg: WsMessage) {
    switch (msg.type) {
      case "update":
        this.config.onCandleUpdate?.(msg);
        break;
      case "close":
        this.config.onCandleClose?.(msg);
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
    // Track subscription for reconnect
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
      this.ws.send(JSON.stringify({
        action: "unsubscribe",
        symbol,
        market,
        tf,
        compression,
      }));
    }
  }

  private sendSubscribe(sub: { symbol: string; market: string; tf: string; compression: number }) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        action: "subscribe",
        ...sub,
      }));
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      console.log(`[WS Client] Reconnecting in ${this.reconnectDelay}ms...`);
      this.connect();
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    }, this.reconnectDelay);
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
```

- [ ] **Step 2: Verify build compiles**

Run: `npm run lint` in `frontend-chart/`
Expected: No errors

---

## Task 3: Add FPS counter to ClusterChart.tsx

**Covers:** §4 (performance monitoring)

**Files:**
- Modify: `frontend-chart/src/components/ClusterChart.tsx`

- [ ] **Step 1: Add FPS counter state and rendering**

Add these imports and state at the top of ClusterChart component (after existing state declarations around line 62):

```typescript
// FPS Counter (dev mode)
const [fps, setFps] = useState(0);
const frameCountRef = useRef(0);
const lastFpsTimeRef = useRef(performance.now());
const rafIdRef = useRef<number>(0);
```

Add this useEffect after the existing canvas rendering useEffect (around line 1631, after the main render block):

```typescript
// FPS Counter — runs alongside the main render
useEffect(() => {
  if (candles.length === 0) return;

  let running = true;
  const measure = () => {
    if (!running) return;
    frameCountRef.current++;
    const now = performance.now();
    const elapsed = now - lastFpsTimeRef.current;
    if (elapsed >= 1000) {
      setFps(Math.round((frameCountRef.current * 1000) / elapsed));
      frameCountRef.current = 0;
      lastFpsTimeRef.current = now;
    }
    rafIdRef.current = requestAnimationFrame(measure);
  };
  rafIdRef.current = requestAnimationFrame(measure);

  return () => {
    running = false;
    cancelAnimationFrame(rafIdRef.current);
  };
}, [candles.length]);
```

Add FPS display in the canvas overlay (inside the JSX, after the canvas element). Find the `<canvas` element and add after it:

```tsx
{/* FPS Counter Overlay */}
{fps > 0 && (
  <div className={`absolute top-2 left-2 z-50 px-2 py-0.5 rounded text-[10px] font-mono font-bold select-none ${
    fps >= 55
      ? theme === "light" ? "bg-green-100 text-green-800" : "bg-green-900/60 text-green-400"
      : fps >= 30
        ? theme === "light" ? "bg-yellow-100 text-yellow-800" : "bg-yellow-900/60 text-yellow-400"
        : theme === "light" ? "bg-red-100 text-red-800" : "bg-red-900/60 text-red-400"
  }`}>
    {fps} FPS
  </div>
)}
```

- [ ] **Step 2: Verify build compiles**

Run: `npm run lint` in `frontend-chart/`
Expected: No errors

---

## Task 4: Add scroll-back loading to ClusterChart.tsx

**Covers:** §3 (history loading on scroll-left)

**Files:**
- Modify: `frontend-chart/src/components/ClusterChart.tsx`

- [ ] **Step 1: Add onLoadMore prop and scroll-back detection**

Add to ClusterChartProps interface (around line 12):

```typescript
interface ClusterChartProps {
  // ... existing props ...
  onLoadMore?: (oldestCandleTime: number) => void;
  isLoadingMore?: boolean;
}
```

Add these to the function signature defaults:

```typescript
onLoadMore,
isLoadingMore = false,
```

Add scroll-back detection useEffect (after the existing scroll-related effects):

```typescript
// Scroll-back history loading trigger
useEffect(() => {
  if (!onLoadMore || isLoadingMore || candles.length === 0) return;
  const container = containerRef.current;
  if (!container) return;

  const handleScroll = () => {
    const scrollLeft = container.scrollLeft;
    // If scrolled within 200px of the left edge, request more data
    if (scrollLeft < 200 && candles.length > 0) {
      const oldestCandle = candles[0];
      onLoadMore(oldestCandle.timestamp);
    }
  };

  container.addEventListener("scroll", handleScroll, { passive: true });
  return () => container.removeEventListener("scroll", handleScroll);
}, [candles.length, onLoadMore, isLoadingMore]);
```

Add loading indicator in JSX (before the FPS counter):

```tsx
{/* Loading more indicator */}
{isLoadingMore && (
  <div className={`absolute top-2 left-1/2 -translate-x-1/2 z-50 px-3 py-1 rounded text-[10px] font-mono font-bold select-none ${
    theme === "light" ? "bg-blue-100 text-blue-800" : "bg-blue-900/60 text-blue-400"
  }`}>
    Loading history...
  </div>
)}
```

- [ ] **Step 2: Verify build compiles**

Run: `npm run lint` in `frontend-chart/`
Expected: No errors

---

## Task 5: Rewrite App.tsx data layer — replace Binance WS with backend WS hub

**Covers:** §1 (REST loading), §3 (scroll-back), §8 (realtime WS), §9 (compression)

**Files:**
- Modify: `frontend-chart/src/App.tsx`

This is the largest change. Replace the direct Binance WebSocket connections and the `getClusterCandles` calls to use the new api.ts and wsClient.ts.

- [ ] **Step 1: Update imports in App.tsx**

Replace the existing api import and add wsClient:

```typescript
import { getClusterCandles } from "./lib/api";
import { WsClient } from "./lib/wsClient";
```

Remove the `fetchBinanceDepth` import (line 22) — DOM will come from backend `/api/dom` later, for now keep EMPTY_ORDER_BOOK fallback.

- [ ] **Step 2: Replace the candle loading useEffect for Chart 0 (lines 713-797)**

Replace the entire useEffect block for Chart 0 data loading with:

```typescript
useEffect(() => {
  let active = true;
  setConnectionStatus("syncing");

  const isFutures = marketType0 === "FUTURES";
  const market = isFutures ? "futures" : "spot";
  const isBtc = activePair0.symbol.toUpperCase().includes("BTC");
  const baseTickStep = isFutures
    ? (activePair0.minTickStepFutures ?? activePair0.minTickStep ?? (isBtc ? 0.1 : getBaseTickSize(activePair0.symbol)))
    : (activePair0.minTickStepSpot ?? activePair0.minTickStep ?? (isBtc ? 0.01 : getBaseTickSize(activePair0.symbol)));

  const baseCompression = isBtc
    ? (isFutures ? 25 : 500)
    : 25;

  const compression = baseCompression * compressionMultiplier0;
  const tickStep = baseTickStep * compression;
  orderBookTickStepRef0.current = tickStep;

  async function loadCandles() {
    try {
      const result = await getClusterCandles({
        symbol: activePair0.symbol,
        market,
        tf: interval0,
        compression,
      });
      if (!active) return;

      setCandles0(result.candles);

      if (result.candles.length > 0) {
        const lastCandle = result.candles[result.candles.length - 1];
        setActivePair0(prev => ({
          ...prev,
          price: lastCandle.close,
          priceStep: tickStep,
        }));
        setPairs(prevPairs => prevPairs.map(p => {
          if (p.symbol === activePair0.symbol) {
            return { ...p, price: lastCandle.close, priceStep: tickStep };
          }
          return p;
        }));
      }

      setConnectionStatus("connected");
    } catch (err) {
      console.warn("[REST 0] Load failed:", err);
      if (!active) return;
      setCandles0([]);
      setConnectionStatus("connected");
    }
  }

  loadCandles();
  setTrades0(EMPTY_TRADES);
  setOrderBook0(EMPTY_ORDER_BOOK);

  return () => { active = false; };
}, [activePair0.symbol, interval0, marketType0, compressionMultiplier0]);
```

- [ ] **Step 3: Replace the candle loading useEffect for Chart 1 (lines 800-884)**

Same pattern as Chart 0 but using `activePair1`, `interval1`, `marketType1`, `compressionMultiplier1`, `setCandles1`, `setActivePair1`, `setTrades1`, `setOrderBook1`.

- [ ] **Step 4: Replace Binance WS useEffect for Chart 0 (lines 1342-1405) with backend WS client**

```typescript
useEffect(() => {
  if (!isTickingAll) {
    setConnectionStatus("stale");
    return;
  }

  const apiBase = (import.meta as any).env?.VITE_API_BASE || "";
  const wsUrl = apiBase.replace(/^http/, "ws") + "/ws";

  const isFutures = marketType0 === "FUTURES";
  const market = isFutures ? "futures" : "spot";
  const isBtc = activePair0.symbol.toUpperCase().includes("BTC");
  const baseCompression = isBtc ? (isFutures ? 25 : 500) : 25;
  const compression = baseCompression * compressionMultiplier0;

  const client = new WsClient({
    url: wsUrl,
    onConnect: () => {
      if (activeChartIndex === 0) setConnectionStatus("connected");
      client.subscribe(activePair0.symbol, market, interval0, compression);
    },
    onCandleUpdate: (msg) => {
      if (msg.candle && msg.symbol === activePair0.symbol) {
        lastTickTimeRef0.current = Date.now();
        // Buffer the update — will be applied in the flush interval
        incomingCandleBufferRef0.current = msg.candle;
      }
    },
    onCandleClose: (msg) => {
      if (msg.candle && msg.symbol === activePair0.symbol) {
        // Replace the last candle with the closed one and add it
        setCandles0(prev => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].timestamp === msg.candle!.timestamp) {
            updated[lastIdx] = msg.candle!;
          } else {
            updated.push(msg.candle!);
          }
          return updated.slice(-getMaxCandlesForInterval(interval0));
        });
      }
    },
    onCandleOpen: (msg) => {
      if (msg.symbol === activePair0.symbol && msg.candle_time) {
        // New candle opened — it will arrive via onCandleUpdate
      }
    },
    onDisconnect: () => {
      if (activeChartIndex === 0) setConnectionStatus("stale");
    },
  });

  client.connect();

  return () => {
    client.disconnect();
  };
}, [isTickingAll, activePair0.symbol, marketType0, interval0, compressionMultiplier0, activeChartIndex]);
```

- [ ] **Step 5: Replace Binance WS useEffect for Chart 1 (lines 1408-1467) with same pattern**

Same as Task 5 Step 4 but for Chart 1 using `activePair1`, `interval1`, `marketType1`, `compressionMultiplier1`.

- [ ] **Step 6: Add incoming candle buffer ref and flush interval**

Add refs after existing refs (around line 674):

```typescript
const incomingCandleBufferRef0 = useRef<any>(null);
const incomingCandleBufferRef1 = useRef<any>(null);
```

Replace the tick flusher useEffect (lines 1470-1487) with:

```typescript
useEffect(() => {
  if (!isTickingAll) return;

  const flusherId = window.setInterval(() => {
    // Flush WS candle updates for Chart 0
    if (incomingCandleBufferRef0.current) {
      const candle = incomingCandleBufferRef0.current;
      incomingCandleBufferRef0.current = null;

      setCandles0(prev => {
        if (prev.length === 0) return prev;
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        // Check if this candle belongs to the current last candle or is new
        if (updated[lastIdx].timestamp === candle.timestamp) {
          updated[lastIdx] = candle;
        } else if (candle.timestamp > updated[lastIdx].timestamp) {
          updated.push(candle);
          return updated.slice(-getMaxCandlesForInterval(intervalRef0.current));
        }
        return updated;
      });
    }

    // Flush WS candle updates for Chart 1
    if (incomingCandleBufferRef1.current) {
      const candle = incomingCandleBufferRef1.current;
      incomingCandleBufferRef1.current = null;

      setCandles1(prev => {
        if (prev.length === 0) return prev;
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (updated[lastIdx].timestamp === candle.timestamp) {
          updated[lastIdx] = candle;
        } else if (candle.timestamp > updated[lastIdx].timestamp) {
          updated.push(candle);
          return updated.slice(-getMaxCandlesForInterval(intervalRef1.current));
        }
        return updated;
      });
    }
  }, 200); // Match backend broadcast interval (200ms)

  return () => window.clearInterval(flusherId);
}, [isTickingAll]);
```

- [ ] **Step 7: Add scroll-back loading handlers**

Add after the existing `processTicksForIdx` function (around line 1269):

```typescript
const [isLoadingMore0, setIsLoadingMore0] = useState(false);
const [isLoadingMore1, setIsLoadingMore1] = useState(false);

const handleLoadMore0 = async (oldestCandleTime: number) => {
  if (isLoadingMore0) return;
  setIsLoadingMore0(true);
  try {
    const isFutures = marketType0 === "FUTURES";
    const market = isFutures ? "futures" : "spot";
    const isBtc = activePair0.symbol.toUpperCase().includes("BTC");
    const baseCompression = isBtc ? (isFutures ? 25 : 500) : 25;
    const compression = baseCompression * compressionMultiplier0;

    const beforeSec = Math.floor(oldestCandleTime / 1000);
    const result = await getClusterCandles({
      symbol: activePair0.symbol,
      market,
      tf: interval0,
      compression,
      before: beforeSec,
      limit: 700,
    });

    if (result.candles.length > 0) {
      setCandles0(prev => {
        // Deduplicate by timestamp
        const existingTimes = new Set(prev.map(c => c.timestamp));
        const newCandles = result.candles.filter(c => !existingTimes.has(c.timestamp));
        return [...newCandles, ...prev];
      });
    }
  } catch (err) {
    console.warn("[REST 0] Load more failed:", err);
  } finally {
    setIsLoadingMore0(false);
  }
};

const handleLoadMore1 = async (oldestCandleTime: number) => {
  if (isLoadingMore1) return;
  setIsLoadingMore1(true);
  try {
    const isFutures = marketType1 === "FUTURES";
    const market = isFutures ? "futures" : "spot";
    const isBtc = activePair1.symbol.toUpperCase().includes("BTC");
    const baseCompression = isBtc ? (isFutures ? 25 : 500) : 25;
    const compression = baseCompression * compressionMultiplier1;

    const beforeSec = Math.floor(oldestCandleTime / 1000);
    const result = await getClusterCandles({
      symbol: activePair1.symbol,
      market,
      tf: interval1,
      compression,
      before: beforeSec,
      limit: 700,
    });

    if (result.candles.length > 0) {
      setCandles1(prev => {
        const existingTimes = new Set(prev.map(c => c.timestamp));
        const newCandles = result.candles.filter(c => !existingTimes.has(c.timestamp));
        return [...newCandles, ...prev];
      });
    }
  } catch (err) {
    console.warn("[REST 1] Load more failed:", err);
  } finally {
    setIsLoadingMore1(false);
  }
};
```

- [ ] **Step 8: Pass onLoadMore and isLoadingMore to ClusterChart components**

In the JSX where ClusterChart is rendered for Chart 0 (around line 2188), add:

```tsx
<ClusterChart
  // ... existing props ...
  onLoadMore={handleLoadMore0}
  isLoadingMore={isLoadingMore0}
/>
```

And for Chart 1 (around line 2264):

```tsx
<ClusterChart
  // ... existing props ...
  onLoadMore={handleLoadMore1}
  isLoadingMore={isLoadingMore1}
/>
```

- [ ] **Step 9: Remove dead Binance-specific code**

Remove:
- `processTicksForIdx` function (lines 886-1268) — replaced by WS candle buffer flush
- `processDepthUpdateForIdx` function (lines 1271-1340) — DOM will come from backend later
- All `incomingTradesBufferRef` usages
- `lastTickTimeRef` usages
- `hasRealDepthStreamRef` usages
- The `fetchBinanceDepth` import
- The `EMPTY_TRADES` import (trades come from WS now)
- Remove `trades0`/`trades1` state and `trades` derived value (or keep for future DOM integration)

- [ ] **Step 10: Verify build compiles**

Run: `npm run lint` in `frontend-chart/`
Expected: No errors

---

## Task 6: Verify end-to-end data flow

**Covers:** All sections — verification

**Files:** None (verification only)

- [ ] **Step 1: Start backend and frontend dev servers**

```bash
# Terminal 1: Backend
cd D:\PROCLUSTER-3\backend
go run ./cmd/...

# Terminal 2: Frontend
cd D:\PROCLUSTER-3\frontend-chart
npm run dev
```

- [ ] **Step 2: Verify REST candle loading**

Open browser, check Network tab:
- `/api/candles?symbol=BTCUSDT&market=spot&tf=15m&compression=500` returns `{ok: true, data: {candles: [...700 items...]}}`
- Chart renders real BTC data

- [ ] **Step 3: Verify WS connection**

Check console: `[WS Client] Connected to ws://...`
Check Network tab: WebSocket connection to `/ws`
Check: subscribe message sent, update messages arriving every ~200ms

- [ ] **Step 4: Verify scroll-back loading**

Scroll chart all the way to the left
Check: "Loading history..." indicator appears
Check: Network tab shows `/api/candles?...&before=<oldest_time>&limit=700`
Check: New candles prepend to the chart

- [ ] **Step 5: Verify FPS counter**

Check: FPS counter visible in top-left of chart area
Check: Shows ~60 FPS with 200+ candles in footprint mode

- [ ] **Step 6: Verify interactive features**

- Mouse wheel zoom to cursor: works
- SHIFT+wheel vertical zoom: works
- CTRL+wheel horizontal zoom: works
- Auto mode switching: works (<70 clusters, 70-300 footprint, ≥300 japanese)
- Compression selector: changes data from backend
- Palettes: red-green / white-gray toggle works
- Drawing tools: lines, levels, channels work
- Workspace 1/2 charts: splitter works

---

## Task 7: Update MEMORY.md Phase 6 status

**Files:**
- Modify: `MEMORY.md`

- [ ] **Step 1: Mark Phase 6 as done**

In `MEMORY.md`, change line 84:
```
- [ ] 6 Адаптация движка + интерактив (zoom/SHIFT/CTRL/auto/workspace) [compose]
```
to:
```
- [x] 6 Адаптация движка + интерактив (zoom/SHIFT/CTRL/auto/workspace) [compose] ✅ DONE
```

- [ ] **Step 2: Add lesson learned**

Add to the end of MEMORY.md:
```markdown

## 14. Уроки из адаптации движка (Phase 6)
- **Backend WS hub protocol**: Client sends `{"action":"subscribe","symbol":"...","market":"...","tf":"...","compression":N}`, server responds with `{"type":"update","candle":{...}}` every 200ms and `{"type":"close","candle":{...}}` + `{"type":"open","candle_time":...}` on candle close. Messages may be batched with `\n` separator in a single WebSocket frame.
- **Backend REST contract**: `GET /api/candles?symbol=&market=&tf=&compression=&before=&limit=` returns `{"ok":true,"data":{"candles":[...],"history_limited":bool}}`. The `before` param is unix seconds for scroll-back.
- **Frontend already has all interactive features**: zoom to cursor, SHIFT/CTRL wheel, Auto mode, palettes, drawing tools, workspace split — these just needed real data connected.
- **Direct Binance WS → Backend WS hub**: Eliminates client-side aggregation, keeps all trade processing server-side. Client just receives pre-computed ClusterCandle updates.
```

---

## Self-Review Checklist

1. **Spec coverage:** §1 (REST loading) → Task 1,5; §3 (scroll-back) → Task 4,5; §4 (performance/FPS) → Task 3; §8 (WS realtime) → Task 2,5; §9 (compression) → Task 1,5
2. **No placeholders:** All code blocks contain complete implementations
3. **Type consistency:** `getClusterCandles` params changed from old format to new backend-matching format; all callers updated in Task 5
4. **TDD skipped by design:** This is a UI/data-layer adaptation — visual verification is the appropriate test strategy

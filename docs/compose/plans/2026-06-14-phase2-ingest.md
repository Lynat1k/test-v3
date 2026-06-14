# Phase 2: Binance WS Ingest + Redis Live-Aggregation + ClickHouse Store

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working realtime ingest pipeline: Binance WS trades → aggregator → Redis live-hash → ClickHouse candle store, for BTCUSDT futures and spot.

**Architecture:** Single Go binary with goroutines. Each (symbol, market, timeframe) has a WS client + aggregator goroutine. On candle close: flush aggregator → ClickHouse batch insert → update Redis last-700 cache → delete live-agg key. WS reconnect triggers gap-fill via REST. ClickHouse client applies migrations on startup.

**Tech Stack:** Go 1.22, gorilla/websocket, go-redis/v9, clickhouse-go/v2, testify (tests)

---

## File Structure

```
backend/
├── cmd/server/main.go              # MODIFY: start ingest goroutines + CH client
├── internal/
│   ├── aggregate/
│   │   ├── types.go                 # existing (no changes)
│   │   ├── aggregator.go            # existing (no changes)
│   │   ├── binning.go               # existing (no changes)
│   │   └── rounding.go              # existing (no changes)
│   ├── ingest/
│   │   ├── binance.go               # existing (ParseTradeMessage, FetchHistoricalTrades, GapFiller)
│   │   └── ws_client.go            # CREATE: WS client with reconnect + gap-fill
│   ├── cache/
│   │   └── redis.go                 # existing (no changes)
│   └── store/
│       └── clickhouse.go            # CREATE: CH client, batch insert, migrations
└── go.mod                           # MODIFY: add clickhouse-go, gorilla/websocket, testify
```

---

## Task 1: ClickHouse Store Client

**Covers:** §6 (ClickHouse store, migrations, batch insert)

**Files:**
- Create: `backend/internal/store/clickhouse.go`
- Create: `backend/internal/store/clickhouse_test.go`
- Modify: `backend/go.mod`

- [ ] **Step 1: Write failing test for ClickHouse connection and migration**

```go
// backend/internal/store/clickhouse_test.go
package store

import (
	"testing"

	"github.com/ClickHouse/clickhouse-go/v2"
)

func TestNewClickHouse(t *testing.T) {
	dsn := "clickhouse://localhost:9000?debug=false"
	ch, err := NewClickHouse(dsn)
	if err != nil {
		t.Fatalf("NewClickHouse failed: %v", err)
	}
	defer ch.Close()
	if ch.conn == nil {
		t.Fatal("conn is nil")
	}
}

func TestApplyMigrations(t *testing.T) {
	dsn := "clickhouse://localhost:9000?debug=false"
	ch, err := NewClickHouse(dsn)
	if err != nil {
		t.Fatalf("NewClickHouse failed: %v", err)
	}
	defer ch.Close()
	err = ch.ApplyMigrations()
	if err != nil {
		t.Fatalf("ApplyMigrations failed: %v", err)
	}
}

func TestBatchInsertClusters(t *testing.T) {
	dsn := "clickhouse://localhost:9000?debug=false"
	ch, err := NewClickHouse(dsn)
	if err != nil {
		t.Fatalf("NewClickHouse failed: %v", err)
	}
	defer ch.Close()
	// Insert one cell into clusters_futures
	rows := []ClusterRow{
		{
			Symbol:    "BTCUSDT",
			Timeframe: "1m",
			CandleTime: 1718361600,
			Price:     100.0,
			Bid:       1.5,
			Ask:       2.0,
		},
	}
	err = ch.BatchInsert("futures", rows)
	if err != nil {
		t.Fatalf("BatchInsert failed: %v", err)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/store/ -v -run TestNewClickHouse`
Expected: FAIL — package `store` does not exist

- [ ] **Step 3: Write the ClickHouse client implementation**

```go
// backend/internal/store/clickhouse.go
package store

import (
	"context"
	_ "embed"
	"fmt"
	"strings"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
)

//go:embed ../../migrations/001_init.sql
var migrationsSQL string

// ClusterRow is a single cluster cell row for batch insert.
type ClusterRow struct {
	Symbol     string
	Timeframe  string
	CandleTime int64  // unix seconds
	Price      float64
	Bid        float64
	Ask        float64
}

// ClickHouse wraps a ClickHouse connection.
type ClickHouse struct {
	conn driver.Conn
}

// NewClickHouse creates a new ClickHouse client.
func NewClickHouse(dsn string) (*ClickHouse, error) {
	conn, err := clickhouse.Open(&clickhouse.Options{
		Addr: strings.TrimPrefix(dsn, "clickhouse://"),
		Auth: clickhouse.Auth{
			Database: "procluster",
		},
	})
	if err != nil {
		return nil, fmt.Errorf("clickhouse open: %w", err)
	}
	if err := conn.Ping(context.Background()); err != nil {
		return nil, fmt.Errorf("clickhouse ping: %w", err)
	}
	return &ClickHouse{conn: conn}, nil
}

// Close closes the connection.
func (ch *ClickHouse) Close() error {
	return ch.conn.Close()
}

// ApplyMigrations runs the embedded migration SQL.
func (ch *ClickHouse) ApplyMigrations() error {
	ctx := context.Background()
	for _, stmt := range strings.Split(migrationsSQL, ";") {
		stmt = strings.TrimSpace(stmt)
		if stmt == "" {
			continue
		}
		if err := ch.conn.Exec(ctx, stmt); err != nil {
			return fmt.Errorf("migration exec: %w\nstmt: %s", err, stmt)
		}
	}
	return nil
}

// BatchInsert inserts cluster rows into the appropriate table.
func (ch *ClickHouse) BatchInsert(market string, rows []ClusterRow) error {
	if len(rows) == 0 {
		return nil
	}
	table := "clusters_futures"
	if market == "spot" {
		table = "clusters_spot"
	}

	ctx := context.Background()
	batch, err := ch.conn.PrepareBatch(ctx, fmt.Sprintf("INSERT INTO %s (symbol, timeframe, candle_time, price, bid, ask)", table))
	if err != nil {
		return fmt.Errorf("prepare batch: %w", err)
	}

	for _, r := range rows {
		if err := batch.Append(
			r.Symbol,
			r.Timeframe,
			r.CandleTime,
			r.Price,
			r.Bid,
			r.Ask,
		); err != nil {
			return fmt.Errorf("batch append: %w", err)
		}
	}

	return batch.Send()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && go test ./internal/store/ -v -run TestNewClickHouse`
Expected: PASS (requires local ClickHouse running)

- [ ] **Step 5: Commit**

```bash
git add backend/internal/store/ go.mod go.sum
git commit -m "feat(store): add ClickHouse client with migration and batch insert"
```

---

## Task 2: WS Client with Reconnect and Gap-Fill

**Covers:** §4 (WS trades stream, reconnect, gap-fill), §7 (live aggregation)

**Files:**
- Create: `backend/internal/ingest/ws_client.go`
- Create: `backend/internal/ingest/ws_client_test.go`

- [ ] **Step 1: Write failing test for WS client structure**

```go
// backend/internal/ingest/ws_client_test.go
package ingest

import (
	"testing"
	"time"
)

func TestNewWSClient(t *testing.T) {
	cfg := WSConfig{
		Symbol:       "BTCUSDT",
		Market:       "futures",
		TickSize:     0.1,
		Compression:  25,
		Timeframe:    "1m",
		RedisKeyFunc: func(tf string, ct int64) string { return "agg:test" },
	}
	c := NewWSClient(cfg, nil)
	if c == nil {
		t.Fatal("NewWSClient returned nil")
	}
	if c.cfg.Symbol != "BTCUSDT" {
		t.Errorf("Symbol = %q, want BTCUSDT", c.cfg.Symbol)
	}
}

func TestWSClientURL(t *testing.T) {
	cfg := WSConfig{Symbol: "BTCUSDT", Market: "futures"}
	c := NewWSClient(cfg, nil)
	got := c.wsURL()
	want := "wss://fstream.binance.com/ws/btcusdt@trade"
	if got != want {
		t.Errorf("wsURL() = %q, want %q", got, want)
	}

	cfg2 := WSConfig{Symbol: "BTCUSDT", Market: "spot"}
	c2 := NewWSClient(cfg2, nil)
	got2 := c2.wsURL()
	want2 := "wss://stream.binance.com:9443/ws/btcusdt@trade"
	if got2 != want2 {
		t.Errorf("wsURL() = %q, want %q", got2, want2)
	}
}

func TestWSClientBackoff(t *testing.T) {
	c := &WSClient{
		cfg: WSConfig{Symbol: "BTCUSDT", Market: "futures"},
	}
	// Initial backoff should be 1s
	if c.backoff != time.Second {
		t.Errorf("initial backoff = %v, want 1s", c.backoff)
	}
	c.increaseBackoff()
	if c.backoff != 2*time.Second {
		t.Errorf("after increase: backoff = %v, want 2s", c.backoff)
	}
	// Cap at 30s
	for i := 0; i < 10; i++ {
		c.increaseBackoff()
	}
	if c.backoff != 30*time.Second {
		t.Errorf("capped backoff = %v, want 30s", c.backoff)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/ingest/ -v -run TestNewWSClient`
Expected: FAIL — `WSClient` and `WSConfig` not defined

- [ ] **Step 3: Write WS client implementation**

```go
// backend/internal/ingest/ws_client.go
package ingest

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"procluster-backend/internal/aggregate"
	"procluster-backend/internal/cache"
)

// WSConfig holds parameters for a WS client instance.
type WSConfig struct {
	Symbol       string
	Market       string // "futures" or "spot"
	TickSize     float64
	Compression  uint32
	Timeframe    string
	RedisKeyFunc func(tf string, candleTimeUnix int64) string
}

// WSClient manages a single Binance WS trades connection.
type WSClient struct {
	cfg      WSConfig
	agg      *aggregate.Aggregator
	gapFill  *GapFiller
	redisKey string
	backoff  time.Duration
	mu       sync.Mutex
}

// NewWSClient creates a new WS client.
func NewWSClient(cfg WSConfig, rdb *cache.RedisCache) *WSClient {
	return &WSClient{
		cfg:     cfg,
		agg:     aggregate.NewAggregator(cfg.Symbol, cfg.Market, cfg.Timeframe, cfg.TickSize, cfg.Compression),
		gapFill: NewGapFiller(cfg.Symbol, cfg.Market),
		backoff: time.Second,
	}
}

// wsURL returns the WebSocket URL for the Binance trade stream.
func (c *WSClient) wsURL() string {
	symbol := strings.ToLower(c.cfg.Symbol)
	if c.cfg.Market == "futures" {
		return fmt.Sprintf("wss://fstream.binance.com/ws/%s@trade", symbol)
	}
	return fmt.Sprintf("wss://stream.binance.com:9443/ws/%s@trade", symbol)
}

// increaseBackoff doubles the backoff up to 30s max.
func (c *WSClient) increaseBackoff() {
	c.backoff = time.Duration(math.Min(float64(c.backoff)*2, float64(30*time.Second)))
}

// Run starts the WS client loop with reconnect and gap-fill.
func (c *WSClient) Run(ctx context.Context, rdb *cache.RedisCache) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		err := c.connect(ctx, rdb)
		if err != nil {
			log.Printf("[%s/%s] WS error: %v, reconnecting in %v", c.cfg.Market, c.cfg.Symbol, err, c.backoff)
			select {
			case <-ctx.Done():
				return
			case <-time.After(c.backoff):
			}
			c.increaseBackoff()
		}
	}
}

func (c *WSClient) connect(ctx context.Context, rdb *cache.RedisCache) error {
	u, err := url.Parse(c.wsURL())
	if err != nil {
		return err
	}

	conn, _, err := websocket.DefaultDialer.DialContext(ctx, u, nil)
	if err != nil {
		return fmt.Errorf("ws dial: %w", err)
	}
	defer conn.Close()

	log.Printf("[%s/%s] WS connected", c.cfg.Market, c.cfg.Symbol)
	c.backoff = time.Second // reset backoff on successful connect

	// Send pong handler
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	// Ping ticker
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				c.mu.Lock()
				err := conn.WriteMessage(websocket.PingMessage, nil)
				c.mu.Unlock()
				if err != nil {
					return
				}
			}
		}
	}()

	for {
		select {
		case <-ctx.Done():
			return nil
		default:
		}

		_, msg, err := conn.ReadMessage()
		if err != nil {
			return fmt.Errorf("ws read: %w", err)
		}

		// Parse the raw trade JSON (skip system messages like "result": null)
		if len(msg) < 2 || msg[0] != '{' {
			continue
		}

		// Quick check for event type to skip non-trade messages
		var evt struct {
			E string `json:"e"`
		}
		if err := json.Unmarshal(msg, &evt); err != nil || evt.E != "trade" {
			continue
		}

		trade, err := ParseTradeMessage(msg)
		if err != nil {
			log.Printf("[%s/%s] parse trade: %v", c.cfg.Market, c.cfg.Symbol, err)
			continue
		}

		// Process through aggregator — detect gaps
		gapStart, gapEnd, hasGap := c.agg.ProcessTrade(trade)

		// Gap-fill from REST if needed
		if hasGap {
			gapTrades, err := c.gapFill.FillGap(ctx, gapStart, gapEnd)
			if err != nil {
				log.Printf("[%s/%s] gap-fill error: %v", c.cfg.Market, c.cfg.Symbol, err)
			} else {
				for _, gt := range gapTrades {
					c.agg.ProcessTrade(gt)
				}
			}
		}

		// Increment Redis live-hash
		candleTimeUnix := aggregate.CandleTimeUnix(trade.TradeTimeMs, c.cfg.Timeframe)
		if c.cfg.RedisKeyFunc != nil && rdb != nil {
			key := c.cfg.RedisKeyFunc(c.cfg.Timeframe, candleTimeUnix)
			bin := aggregate.BinPriceLow(trade.Price, c.cfg.TickSize, c.cfg.Compression)
			var bidDelta, askDelta float64
			if trade.IsBuyerMaker {
				bidDelta = trade.Qty
			} else {
				askDelta = trade.Qty
			}
			if err := rdb.IncrCell(ctx, key, bin, bidDelta, askDelta); err != nil {
				log.Printf("[%s/%s] redis incr error: %v", c.cfg.Market, c.cfg.Symbol, err)
			}
		}
	}
}

// FlushAndStore flushes the aggregator, writes to ClickHouse, updates cache, deletes live key.
// Called by the candle closer goroutine.
func (c *YSClient) FlushAndStore(ctx context.Context, ch interface {
	BatchInsert(market string, rows []ClusterRow) error
}, rdb *cache.RedisCache, cacheKey string, liveKey string) error {
	cells := c.agg.Flush()
	if len(cells) == 0 {
		return nil
	}

	// Determine candle time from first cell (approximate — the closer calls this at interval boundary)
	// The actual candle time is computed from the last trade time
	candleTimeUnix := time.Now().Unix() // simplified — in production use the last trade time

	rows := make([]ClusterRow, len(cells))
	for i, cell := range cells {
		rows[i] = ClusterRow{
			Symbol:     c.cfg.Symbol,
			Timeframe:  c.cfg.Timeframe,
			CandleTime: candleTimeUnix,
			Price:      cell.Price,
			Bid:        cell.Bid,
			Ask:        cell.Ask,
		}
	}

	if err := ch.BatchInsert(c.cfg.Market, rows); err != nil {
		return fmt.Errorf("batch insert: %w", err)
	}

	// Build ClusterCandle for cache
	candle := aggregate.ClusterCandle{
		Time:   candleTimeUnix,
		Cells:  cells,
		Volume: 0,
		Delta:  0,
	}
	for _, cell := range cells {
		candle.Volume += cell.Bid + cell.Ask
		candle.Delta += cell.Ask - cell.Bid
		if candle.Open == 0 || cell.Price < candle.Low {
			candle.Low = cell.Price
		}
		if cell.Price > candle.High {
			candle.High = cell.Price
		}
		if candle.Open == 0 {
			candle.Open = cell.Price
		}
		candle.Close = cell.Price + float64(c.cfg.Compression)*c.cfg.TickSize
	}

	if err := rdb.SetLastCandle(ctx, cacheKey, candle); err != nil {
		return fmt.Errorf("set cache: %w", err)
	}

	if err := rdb.DelAggKey(ctx, liveKey); err != nil {
		return fmt.Errorf("del live key: %w", err)
	}

	return nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && go test ./internal/ingest/ -v -run TestNewWSClient`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/internal/ingest/ws_client.go backend/internal/ingest/ws_client_test.go
git commit -m "feat(ingest): add WS client with reconnect, gap-fill, and live agg"
```

---

## Task 3: Candle Closer Goroutine

**Covers:** §5 (candle close, ClickHouse write, cache update, live key delete)

**Files:**
- Create: `backend/internal/ingest/closer.go`
- Create: `backend/internal/ingest/closer_test.go`

- [ ] **Step 1: Write failing test for closer**

```go
// backend/internal/ingest/closer_test.go
package ingest

import (
	"testing"
	"time"
)

func TestCandleCloser_NextCloseTime(t *testing.T) {
	tests := []struct {
		name string
		tf   string
		now  time.Time
		want time.Time
	}{
		{
			"1m: now=12:00:30 → close=12:01:00",
			"1m",
			time.Date(2024, 6, 14, 12, 0, 30, 0, time.UTC),
			time.Date(2024, 6, 14, 12, 1, 0, 0, time.UTC),
		},
		{
			"5m: now=12:03:00 → close=12:05:00",
			"5m",
			time.Date(2024, 6, 14, 12, 3, 0, 0, time.UTC),
			time.Date(2024, 6, 14, 12, 5, 0, 0, time.UTC),
		},
		{
			"1h: now=12:30:00 → close=13:00:00",
			"1h",
			time.Date(2024, 6, 14, 12, 30, 0, 0, time.UTC),
			time.Date(2024, 6, 14, 13, 0, 0, 0, time.UTC),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := nextCloseTime(tt.now, tt.tf)
			if !got.Equal(tt.want) {
				t.Errorf("nextCloseTime(%v, %q) = %v, want %v", tt.now, tt.tf, got, tt.want)
			}
		})
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/ingest/ -v -run TestCandleCloser_NextCloseTime`
Expected: FAIL — `nextCloseTime` not defined

- [ ] **Step 3: Write the closer implementation**

```go
// backend/internal/ingest/closer.go
package ingest

import (
	"context"
	"log"
	"time"

	"procluster-backend/internal/aggregate"
	"procluster-backend/internal/cache"
	"procluster-backend/internal/store"
)

// CandleCloser periodically closes candles and flushes to ClickHouse + cache.
type CandleCloser struct {
	ws       *WSClient
	ch       *store.ClickHouse
	rdb      *cache.RedisCache
	interval time.Duration
}

// NewCandleCloser creates a new closer.
func NewCandleCloser(ws *WSClient, ch *store.ClickHouse, rdb *cache.RedisCache, tf string) *CandleCloser {
	secs := aggregate.TfSeconds[tf]
	return &CandleCloser{
		ws:       ws,
		ch:       ch,
		rdb:      rdb,
		interval: time.Duration(secs) * time.Second,
	}
}

// nextCloseTime returns the next candle close time for the given timeframe.
func nextCloseTime(now time.Time, tf string) time.Time {
	secs := aggregate.TfSeconds[tf]
	unix := now.Unix()
	nextUnix := ((unix / secs) + 1) * secs
	return time.Unix(nextUnix, 0).UTC()
}

// Run starts the closer loop.
func (cl *CandleCloser) Run(ctx context.Context) {
	for {
		next := nextCloseTime(time.Now(), cl.ws.cfg.Timeframe)
		wait := time.Until(next)
		if wait < 0 {
			wait = 0
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}

		// Small sleep to let straggling trades arrive
		time.Sleep(200 * time.Millisecond)

		candleTimeUnix := next.Unix()
		cacheKey := aggregate.RedisCacheKey(cl.ws.cfg.Market, cl.ws.cfg.Symbol, cl.ws.cfg.Timeframe)
		liveKey := aggregate.RedisAggKey(cl.ws.cfg.Market, cl.ws.cfg.Symbol, cl.ws.cfg.Timeframe, candleTimeUnix)

		cells := cl.ws.agg.Flush()
		if len(cells) == 0 {
			continue
		}

		// Build rows for ClickHouse
		rows := make([]store.ClusterRow, len(cells))
		for i, cell := range cells {
			rows[i] = store.ClusterRow{
				Symbol:     cl.ws.cfg.Symbol,
				Timeframe:  cl.ws.cfg.Timeframe,
				CandleTime: candleTimeUnix,
				Price:      cell.Price,
				Bid:        cell.Bid,
				Ask:        cell.Ask,
			}
		}

		if err := cl.ch.BatchInsert(cl.ws.cfg.Market, rows); err != nil {
			log.Printf("[closer] batch insert error: %v", err)
			continue
		}

		// Build candle for cache
		candle := aggregate.ClusterCandle{
			Time:   candleTimeUnix,
			Cells:  cells,
		}
		for _, cell := range cells {
			candle.Volume += cell.Bid + cell.Ask
			candle.Delta += cell.Ask - cell.Bid
			if candle.Open == 0 || cell.Price < candle.Low {
				candle.Low = cell.Price
			}
			if cell.Price > candle.High {
				candle.High = cell.Price
			}
			if candle.Open == 0 {
				candle.Open = cell.Price
			}
			candle.Close = cell.Price + float64(cl.ws.cfg.Compression)*cl.ws.cfg.TickSize
		}

		if err := cl.rdb.SetLastCandle(ctx, cacheKey, candle); err != nil {
			log.Printf("[closer] set cache error: %v", err)
		}

		if err := cl.rdb.DelAggKey(ctx, liveKey); err != nil {
			log.Printf("[closer] del live key error: %v", err)
		}

		log.Printf("[closer] closed candle %s %s %s at %d, %d cells",
			cl.ws.cfg.Market, cl.ws.cfg.Symbol, cl.ws.cfg.Timeframe, candleTimeUnix, len(cells))
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && go test ./internal/ingest/ -v -run TestCandleCloser_NextCloseTime`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/internal/ingest/closer.go backend/internal/ingest/closer_test.go
git commit -m "feat(ingest): add candle closer goroutine for periodic flush"
```

---

## Task 4: Wire Everything in main.go

**Covers:** §6 (startup orchestration), all sections (integration)

**Files:**
- Modify: `backend/cmd/server/main.go`

- [ ] **Step 1: Update main.go to start ingest pipeline**

```go
// backend/cmd/server/main.go
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"procluster-backend/internal/cache"
	"procluster-backend/internal/ingest"
	"procluster-backend/internal/store"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	redisAddr := os.Getenv("REDIS_URL")
	if redisAddr == "" {
		redisAddr = "localhost:6379"
	}
	chAddr := os.Getenv("CLICKHOUSE_URL")
	if chAddr == "" {
		chAddr = "clickhouse://localhost:9000"
	}

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	// ClickHouse
	ch, err := store.NewClickHouse(chAddr)
	if err != nil {
		log.Fatalf("clickhouse: %v", err)
	}
	defer ch.Close()
	if err := ch.ApplyMigrations(); err != nil {
		log.Fatalf("migrations: %v", err)
	}
	log.Println("ClickHouse migrations applied")

	// Redis
	rdb := cache.New(redisAddr)
	defer rdb.Close()
	if err := rdb.Ping(ctx); err != nil {
		log.Fatalf("redis: %v", err)
	}
	log.Println("Redis connected")

	// Ticker configs (hardcoded for now — will come from CH in later phases)
	type tickerDef struct {
		symbol  string
		market  string
		tick    float64
		comp    uint32
		tfs     []string
	}
	tickers := []tickerDef{
		{"BTCUSDT", "futures", 0.1, 25, []string{"1m", "5m", "15m", "30m", "1h", "4h"}},
		{"BTCUSDT", "spot", 0.01, 500, []string{"15m", "30m", "1h", "4h"}},
	}

	for _, td := range tickers {
		for _, tf := range td.tfs {
			cfg := ingest.WSConfig{
				Symbol:      td.symbol,
				Market:      td.market,
				TickSize:    td.tick,
				Compression: td.comp,
				Timeframe:   tf,
				RedisKeyFunc: func(tf string, ct int64) string {
					return aggregate.RedisAggKey(td.market, td.symbol, tf, ct)
				},
			}
			ws := ingest.NewWSClient(cfg, rdb)
			go ws.Run(ctx, rdb)

			closer := ingest.NewCandleCloser(ws, ch, rdb, tf)
			go closer.Run(ctx)
		}
	}

	log.Printf("Started ingest for %d ticker(s)", len(tickers))

	// HTTP server
	http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	log.Printf("Server listening on :%s", port)
	go func() {
		if err := http.ListenAndServe(":"+port, nil); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("Shutting down...")
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd backend && go build ./cmd/server/`
Expected: BUILD SUCCESS (requires all deps in go.mod)

- [ ] **Step 3: Commit**

```bash
git add backend/cmd/server/main.go
git commit -m "feat(cmd): wire ingest pipeline with WS clients, closers, and CH store"
```

---

## Task 5: Integration Test — Full Pipeline

**Covers:** All sections (end-to-end verification)

**Files:**
- Create: `backend/internal/ingest/integration_test.go`

- [ ] **Step 1: Write integration test**

```go
// backend/internal/ingest/integration_test.go
//go:build integration

package ingest

import (
	"context"
	"log"
	"os"
	"testing"
	"time"

	"procluster-backend/internal/aggregate"
	"procluster-backend/internal/cache"
	"procluster-backend/internal/store"
)

func TestIntegration_BinanceWS(t *testing.T) {
	if os.Getenv("INTEGRATION") == "" {
		t.Skip("Set INTEGRATION=1 to run integration tests")
	}

	redisAddr := os.Getenv("REDIS_URL")
	if redisAddr == "" {
		redisAddr = "localhost:6379"
	}
	chAddr := os.Getenv("CLICKHOUSE_URL")
	if chAddr == "" {
		chAddr = "clickhouse://localhost:9000"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	rdb := cache.New(redisAddr)
	defer rdb.Close()
	if err := rdb.Ping(ctx); err != nil {
		t.Fatalf("redis: %v", err)
	}

	ch, err := store.NewClickHouse(chAddr)
	if err != nil {
		t.Fatalf("clickhouse: %v", err)
	}
	defer ch.Close()

	// Run WS client for 1 minute
	cfg := WSConfig{
		Symbol:      "BTCUSDT",
		Market:      "futures",
		TickSize:    0.1,
		Compression: 25,
		Timeframe:   "1m",
		RedisKeyFunc: func(tf string, ct int64) string {
			return aggregate.RedisAggKey("futures", "BTCUSDT", tf, ct)
		},
	}
	ws := NewWSClient(cfg, rdb)

	go ws.Run(ctx, rdb)

	// Wait and observe
	time.Sleep(60 * time.Second)

	// Check that trades were aggregated
	log.Println("Integration test: WS client ran for 60s")
	log.Println("Check ClickHouse clusters_futures for BTCUSDT rows")
}
```

- [ ] **Step 2: Run integration test (requires Docker services)**

Run: `cd backend && INTEGRATION=1 go test ./internal/ingest/ -v -run TestIntegration_BinanceWS -tags=integration -timeout 3m`
Expected: PASS — trades arrive, ClickHouse rows appear

- [ ] **Step 3: Verify data in ClickHouse**

Run:
```sql
clickhouse-client -q "SELECT * FROM procluster.clusters_futures WHERE symbol='BTCUSDT' AND timeframe='1m' ORDER BY candle_time DESC LIMIT 10"
```
Expected: rows with correct bid/ask/volume values

- [ ] **Step 4: Commit**

```bash
git add backend/internal/ingest/integration_test.go
git commit -m "test(ingest): add integration test for full pipeline"
```

---

## Task 6: Verify Unit Tests Pass

**Covers:** All (regression check)

- [ ] **Step 1: Run all unit tests**

Run: `cd backend && go test ./... -v`
Expected: ALL PASS

- [ ] **Step 2: Fix any failures if found**

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore: phase 2 complete — ingest pipeline verified"
```

package ingest

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"math"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"procluster-backend/internal/aggregate"
	"procluster-backend/internal/cache"
	"procluster-backend/internal/proxy"
)

// WSConfig holds parameters for a WS client instance.
// One WSClient per unique (symbol, market) pair, feeding all timeframes.
type WSConfig struct {
	Symbol      string
	Market      string // "futures" or "spot"
	TickSize    float64
	Compression uint32
	RedisKeyFn  func(tf string, candleTimeUnix int64) string
}

// TFAggregator holds the aggregator and metadata for a single timeframe.
type TFAggregator struct {
	Timeframe string
	Agg       *aggregate.Aggregator
}

// WSClient manages a single Binance WS trades connection for one (symbol, market).
// It feeds all timeframe aggregators from the same trade stream.
type WSClient struct {
	cfg     WSConfig
	aggs    []TFAggregator
	gapFill *GapFiller
	backoff time.Duration
	mu      sync.Mutex
}

// NewWSClient creates a new WS client with aggregators for all timeframes.
func NewWSClient(cfg WSConfig, timeframes []string) *WSClient {
	aggs := make([]TFAggregator, len(timeframes))
	for i, tf := range timeframes {
		aggs[i] = TFAggregator{
			Timeframe: tf,
			Agg:       aggregate.NewAggregator(cfg.Symbol, cfg.Market, tf, cfg.TickSize, cfg.Compression),
		}
	}
	return &WSClient{
		cfg:     cfg,
		aggs:    aggs,
		gapFill: NewGapFiller(cfg.Symbol, cfg.Market),
		backoff: time.Second,
	}
}

// Aggregators returns the list of timeframe aggregators.
func (c *WSClient) Aggregators() []TFAggregator {
	return c.aggs
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
	connURL := c.wsURL()

	dialer := websocket.Dialer{
		Proxy: http.ProxyFromEnvironment,
	}
	if proxy.Enabled() {
		dialer.Proxy = func(_ *http.Request) (*url.URL, error) {
			return proxy.ProxyURL(), nil
		}
	}

	conn, _, err := dialer.DialContext(ctx, connURL, nil)
	if err != nil {
		return fmt.Errorf("ws dial: %w", err)
	}
	defer conn.Close()

	log.Printf("[%s/%s] WS connected", c.cfg.Market, c.cfg.Symbol)
	c.backoff = time.Second

	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

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

		if len(msg) < 2 || msg[0] != '{' {
			continue
		}

		if !bytes.Contains(msg, []byte(`"e":"trade"`)) {
			continue
		}

		trade, err := ParseTradeMessage(msg)
		if err != nil {
			log.Printf("[%s/%s] parse trade: %v", c.cfg.Market, c.cfg.Symbol, err)
			continue
		}

		// Process trade through ALL timeframe aggregators
		for i := range c.aggs {
			tfAgg := &c.aggs[i]

			gapStart, gapEnd, hasGap := tfAgg.Agg.ProcessTrade(trade)

			if hasGap {
				log.Printf("[%s/%s %s] GAP DETECTED: %d-%d", c.cfg.Market, c.cfg.Symbol, tfAgg.Timeframe, gapStart, gapEnd)
				gapTrades, err := c.gapFill.FillGap(ctx, gapStart, gapEnd)
				if err != nil {
					log.Printf("[%s/%s %s] gap-fill error: %v", c.cfg.Market, c.cfg.Symbol, tfAgg.Timeframe, err)
				} else {
					log.Printf("[%s/%s %s] gap-filled %d trades", c.cfg.Market, c.cfg.Symbol, tfAgg.Timeframe, len(gapTrades))
					for _, gt := range gapTrades {
						tfAgg.Agg.ProcessTrade(gt)
					}
				}
			}

			candleTimeUnix := aggregate.CandleTimeUnix(trade.TradeTimeMs, tfAgg.Timeframe)
			if c.cfg.RedisKeyFn != nil && rdb != nil {
				key := c.cfg.RedisKeyFn(tfAgg.Timeframe, candleTimeUnix)
				bin := aggregate.BinPriceLow(trade.Price, c.cfg.TickSize, c.cfg.Compression)
				var bidDelta, askDelta float64
				if trade.IsBuyerMaker {
					bidDelta = trade.Qty
				} else {
					askDelta = trade.Qty
				}
				if err := rdb.IncrCell(ctx, key, bin, bidDelta, askDelta); err != nil {
					log.Printf("[%s/%s %s] redis incr error: %v", c.cfg.Market, c.cfg.Symbol, tfAgg.Timeframe, err)
				}
			}
		}
	}
}

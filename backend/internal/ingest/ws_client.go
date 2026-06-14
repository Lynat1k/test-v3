package ingest

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"procluster-backend/internal/aggregate"
	"procluster-backend/internal/cache"
)

// WSConfig holds parameters for a WS client instance.
type WSConfig struct {
	Symbol      string
	Market      string // "futures" or "spot"
	TickSize    float64
	Compression uint32
	Timeframe   string
	RedisKeyFn  func(tf string, candleTimeUnix int64) string
}

// WSClient manages a single Binance WS trades connection.
type WSClient struct {
	cfg     WSConfig
	agg     *aggregate.Aggregator
	gapFill *GapFiller
	backoff time.Duration
	mu      sync.Mutex
}

// NewWSClient creates a new WS client.
func NewWSClient(cfg WSConfig) *WSClient {
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
	connURL := c.wsURL()

	conn, _, err := websocket.DefaultDialer.DialContext(ctx, connURL, nil)
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

		gapStart, gapEnd, hasGap := c.agg.ProcessTrade(trade)

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

		candleTimeUnix := aggregate.CandleTimeUnix(trade.TradeTimeMs, c.cfg.Timeframe)
		if c.cfg.RedisKeyFn != nil && rdb != nil {
			key := c.cfg.RedisKeyFn(c.cfg.Timeframe, candleTimeUnix)
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

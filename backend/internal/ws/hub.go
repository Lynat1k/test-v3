package ws

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"procluster-backend/internal/aggregate"
	"procluster-backend/internal/cache"
)

const (
	defaultTickInterval = 200 * time.Millisecond
	defaultWriteBufSize = 256
)

// Hub manages all WebSocket clients and broadcasts live candle updates.
type Hub struct {
	rdb       *cache.RedisCache
	Validator Validator

	mu      sync.RWMutex
	clients map[*Client]struct{}
	// subs maps "market:symbol:tf:compression" → set of clients
	subs map[string]map[*Client]struct{}

	broadcastInterval time.Duration
	writeBufSize      int
}

type Validator interface {
	GetConfig(symbol, market string) (aggregate.TickerConfig, bool)
	ValidateCompression(comp uint32, tc aggregate.TickerConfig) error
	ValidateTF(tf string, tc aggregate.TickerConfig) error
}

type HubConfig struct {
	BroadcastInterval time.Duration
	WriteBufSize      int
}

func NewHub(rdb *cache.RedisCache, v Validator, cfg HubConfig) *Hub {
	if cfg.BroadcastInterval == 0 {
		cfg.BroadcastInterval = defaultTickInterval
	}
	if cfg.WriteBufSize == 0 {
		cfg.WriteBufSize = defaultWriteBufSize
	}
	return &Hub{
		rdb:               rdb,
		Validator:         v,
		clients:           make(map[*Client]struct{}),
		subs:              make(map[string]map[*Client]struct{}),
		broadcastInterval: cfg.BroadcastInterval,
		writeBufSize:      cfg.WriteBufSize,
	}
}

func subKey(market, symbol, tf string, compression uint32) string {
	return market + ":" + symbol + ":" + tf + ":" + itoa(compression)
}

func itoa(n uint32) string {
	return string(appendU32(nil, n))
}

func appendU32(buf []byte, n uint32) []byte {
	if n == 0 {
		return append(buf, '0')
	}
	var tmp [10]byte
	i := len(tmp)
	for n > 0 {
		i--
		tmp[i] = byte('0' + n%10)
		n /= 10
	}
	return append(buf, tmp[i:]...)
}

// Register adds a client to the hub.
func (h *Hub) Register(c *Client) {
	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()
	log.Printf("[WS] client connected: %s (%d total)", c.RemoteAddr(), h.ClientCount())
}

// Unregister removes a client and all its subscriptions.
func (h *Hub) Unregister(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.clients, c)
	for key, set := range h.subs {
		delete(set, c)
		if len(set) == 0 {
			delete(h.subs, key)
		}
	}
	log.Printf("[WS] client disconnected: %s (%d total)", c.RemoteAddr(), h.ClientCount())
}

// Subscribe adds a client to a subscription.
func (h *Hub) Subscribe(c *Client, market, symbol, tf string, compression uint32) error {
	tc, ok := h.Validator.GetConfig(symbol, market)
	if !ok {
		return &SubError{Code: "UNKNOWN_TICKER", Message: "unknown symbol/market"}
	}
	if err := h.Validator.ValidateTF(tf, tc); err != nil {
		return &SubError{Code: "INVALID_PARAMS", Message: "invalid timeframe"}
	}
	if err := h.Validator.ValidateCompression(compression, tc); err != nil {
		return &SubError{Code: "INVALID_PARAMS", Message: err.Error()}
	}
	if compression == 0 {
		compression = tc.BaseCompression
	}

	key := subKey(market, symbol, tf, compression)
	h.mu.Lock()
	c.mu.Lock()
	if len(c.subKeys) >= maxSubsPerClient {
		c.mu.Unlock()
		h.mu.Unlock()
		return &SubError{Code: "LIMIT_EXCEEDED", Message: "max subscriptions per connection"}
	}
	c.subKeys[key] = true
	c.mu.Unlock()

	set, ok := h.subs[key]
	if !ok {
		set = make(map[*Client]struct{})
		h.subs[key] = set
	}
	set[c] = struct{}{}
	h.mu.Unlock()
	return nil
}

// Unsubscribe removes a client from a subscription.
func (h *Hub) Unsubscribe(c *Client, market, symbol, tf string, compression uint32) {
	key := subKey(market, symbol, tf, compression)
	h.mu.Lock()
	c.mu.Lock()
	delete(c.subKeys, key)
	c.mu.Unlock()
	if set, ok := h.subs[key]; ok {
		delete(set, c)
		if len(set) == 0 {
			delete(h.subs, key)
		}
	}
	h.mu.Unlock()
}

// ClientCount returns the number of connected clients.
func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// parseSubKey splits "market:symbol:tf:compression" back into components.
func parseSubKey(key string) (market, symbol, tf string, compression uint32) {
	// Find last colon (compression)
	idx := len(key) - 1
	for idx >= 0 && key[idx] != ':' {
		idx--
	}
	if idx < 0 {
		return
	}
	compStr := key[idx+1:]
	compression = parseU32(compStr)
	rest := key[:idx]

	// Find second-to-last colon (tf)
	idx2 := len(rest) - 1
	for idx2 >= 0 && rest[idx2] != ':' {
		idx2--
	}
	if idx2 < 0 {
		return
	}
	tf = rest[idx2+1:]
	rest2 := rest[:idx2]

	// Find first colon (market)
	idx3 := 0
	for idx3 < len(rest2) && rest2[idx3] != ':' {
		idx3++
	}
	market = rest2[:idx3]
	symbol = rest2[idx3+1:]
	return
}

func parseU32(s string) uint32 {
	var n uint32
	for _, c := range s {
		if c >= '0' && c <= '9' {
			n = n*10 + uint32(c-'0')
		}
	}
	return n
}

// Run starts the broadcast loop. Call this once and it runs until ctx is done.
func (h *Hub) Run(ctx context.Context) {
	ticker := time.NewTicker(h.broadcastInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.broadcastTick(ctx)
		}
	}
}

// broadcastTick reads all unique subscriptions from Redis and broadcasts to clients.
func (h *Hub) broadcastTick(ctx context.Context) {
	h.mu.RLock()
	// Collect unique subscription keys
	keys := make(map[string]bool, len(h.subs))
	for key := range h.subs {
		keys[key] = true
	}
	h.mu.RUnlock()

	for key := range keys {
		h.broadcastSub(ctx, key)
	}
}

// broadcastSub reads the live aggregation for one subscription and sends to all subscribers.
func (h *Hub) broadcastSub(ctx context.Context, key string) {
	market, symbol, tf, compression := parseSubKey(key)

	tc, ok := h.Validator.GetConfig(symbol, market)
	if !ok {
		return
	}
	if compression == 0 {
		compression = tc.BaseCompression
	}

	// Get current candle time
	nowSec := time.Now().Unix()
	secs := aggregate.TfSeconds[tf]
	if secs == 0 {
		return
	}
	candleTimeUnix := (nowSec / secs) * secs

	aggKey := aggregate.RedisAggKey(market, symbol, tf, candleTimeUnix)
	cells, err := h.rdb.GetAggCells(ctx, aggKey)
	if err != nil || len(cells) == 0 {
		return
	}

	// If higher compression, merge
	if compression > tc.BaseCompression {
		groupSize := compression / tc.BaseCompression
		cells = aggregate.MergeCells(cells, groupSize, tc.TickSize, tc.BaseCompression)
	}

	// Build ClusterCandle
	candle := aggregate.ClusterCandle{
		Time:  candleTimeUnix,
		Cells: cells,
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
		candle.Close = cell.Price + float64(compression)*tc.TickSize
	}
	candle.Volume = round1(candle.Volume)
	candle.Delta = round1(candle.Delta)

	// Build JSON message
	msg := SubMessage{
		Type:   "update",
		Symbol: symbol,
		Market: market,
		TF:     tf,
		Comp:   compression,
		Candle: &candle,
	}

	data, err := json.Marshal(msg)
	if err != nil {
		return
	}

	// Send to all subscribers
	h.mu.RLock()
	set, ok := h.subs[key]
	if !ok {
		h.mu.RUnlock()
		return
	}
	clients := make([]*Client, 0, len(set))
	for c := range set {
		clients = append(clients, c)
	}
	h.mu.RUnlock()

	for _, c := range clients {
		select {
		case c.send <- data:
		default:
			// Buffer full — drop and disconnect
			log.Printf("[WS] backpressure disconnect: %s (buf full for %s)", c.RemoteAddr(), key)
			go c.Close()
		}
	}
}

// BroadcastClose sends a close message and triggers an open message for a new candle.
// Called by CandleCloser when a candle is closed.
func (h *Hub) BroadcastClose(market, symbol, tf string, compression uint32, candle aggregate.ClusterCandle) {
	key := subKey(market, symbol, tf, compression)

	tc, ok := h.Validator.GetConfig(symbol, market)
	if !ok {
		return
	}
	if compression == 0 {
		compression = tc.BaseCompression
	}

	// Close message
	closeMsg := SubMessage{
		Type:   "close",
		Symbol: symbol,
		Market: market,
		TF:     tf,
		Comp:   compression,
		Candle: &candle,
	}
	closeData, err := json.Marshal(closeMsg)
	if err != nil {
		return
	}

	h.mu.RLock()
	set, ok := h.subs[key]
	if !ok {
		h.mu.RUnlock()
		return
	}
	clients := make([]*Client, 0, len(set))
	for c := range set {
		clients = append(clients, c)
	}
	h.mu.RUnlock()

	for _, c := range clients {
		select {
		case c.send <- closeData:
		default:
			go c.Close()
		}
	}

	// Open message (new candle)
	openMsg := SubMessage{
		Type:       "open",
		Symbol:     symbol,
		Market:     market,
		TF:         tf,
		Comp:       compression,
		CandleTime: candleTimeNow(tf),
	}
	openData, err := json.Marshal(openMsg)
	if err != nil {
		return
	}
	for _, c := range clients {
		select {
		case c.send <- openData:
		default:
			go c.Close()
		}
	}
}

func candleTimeNow(tf string) int64 {
	secs := aggregate.TfSeconds[tf]
	now := time.Now().Unix()
	return (now / secs) * secs
}

func round1(v float64) float64 {
	return float64(int64(v*10+0.5)) / 10
}

// NotifyCandleClose sends close/open to all compression levels for a subscription.
func (h *Hub) NotifyCandleClose(market, symbol, tf string, candleTimeUnix int64, cells []aggregate.ClusterCell) {
	h.mu.RLock()
	seen := make(map[uint32]bool)
	for key := range h.subs {
		m, s, t, c := parseSubKey(key)
		if m == market && s == symbol && t == tf && !seen[c] {
			seen[c] = true
			go h.BroadcastCloseSorted(market, symbol, tf, c, candleTimeUnix, cells)
		}
	}
	h.mu.RUnlock()
}

// BroadcastCloseSorted sends close for a given candle time and cells.
func (h *Hub) BroadcastCloseSorted(market, symbol, tf string, compression uint32, candleTimeUnix int64, cells []aggregate.ClusterCell) {
	tc, ok := h.Validator.GetConfig(symbol, market)
	if !ok {
		return
	}
	if compression == 0 {
		compression = tc.BaseCompression
	}

	// If higher compression, merge
	if compression > tc.BaseCompression {
		groupSize := compression / tc.BaseCompression
		cells = aggregate.MergeCells(cells, groupSize, tc.TickSize, tc.BaseCompression)
	}

	candle := aggregate.ClusterCandle{
		Time:  candleTimeUnix,
		Cells: cells,
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
		candle.Close = cell.Price + float64(compression)*tc.TickSize
	}
	candle.Volume = round1(candle.Volume)
	candle.Delta = round1(candle.Delta)

	h.BroadcastClose(market, symbol, tf, compression, candle)
}

package aggregate

import (
	"fmt"
	"log"
	"math"
	"sort"
	"time"
)

// TfSeconds maps timeframe string to seconds.
var TfSeconds = map[string]int64{
	"1m":  60,
	"5m":  300,
	"15m": 900,
	"30m": 1800,
	"1h":  3600,
	"4h":  14400,
}

// CandleTimeUnix returns the candle open time (unix seconds) for a given trade time.
func CandleTimeUnix(tradeTimeMs int64, tf string) int64 {
	secs, ok := TfSeconds[tf]
	if !ok {
		return 0
	}
	tradeSec := tradeTimeMs / 1000
	return (tradeSec / secs) * secs
}

// CandleTime returns the candle open time as time.Time (UTC).
func CandleTime(tradeTimeMs int64, tf string) time.Time {
	return time.Unix(CandleTimeUnix(tradeTimeMs, tf), 0).UTC()
}

// Aggregator holds in-memory state for live aggregation of a single
// (symbol, market, timeframe) stream. It accumulates trades into
// ClusterCells keyed by binPriceLow.
type Aggregator struct {
	Symbol    string
	Market    string
	Timeframe string
	TickSize  float64
	Comp      uint32

	// cells keyed by binPriceLow (string representation for Redis key)
	cells map[float64]*ClusterCell
	// tradeId dedup set
	seen map[int64]bool
	// last known tradeId for gap detection
	lastTradeID int64
	// LogGaps controls whether gap detection logs messages (disable for history loading)
	LogGaps bool
}

// NewAggregator creates a new aggregator.
func NewAggregator(symbol, market, tf string, tickSize float64, compression uint32) *Aggregator {
	return &Aggregator{
		Symbol:    symbol,
		Market:    market,
		Timeframe: tf,
		TickSize:  tickSize,
		Comp:      compression,
		cells:     make(map[float64]*ClusterCell),
		seen:      make(map[int64]bool),
		LogGaps:   true,
	}
}

// ProcessTrade processes a single trade: dedup, bin, accumulate.
// Returns gap info if a tradeId gap is detected.
func (a *Aggregator) ProcessTrade(t Trade) (gapStart, gapEnd int64, hasGap bool) {
	// Dedup
	if a.seen[t.TradeID] {
		return 0, 0, false
	}
	a.seen[t.TradeID] = true

	// Gap detection
	if a.lastTradeID > 0 && t.TradeID > a.lastTradeID+1 {
		gapStart = a.lastTradeID + 1
		gapEnd = t.TradeID - 1
		hasGap = true
		if a.LogGaps {
			log.Printf("tradeId gap detected: %d–%d (last=%d, current=%d)",
				gapStart, gapEnd, a.lastTradeID, t.TradeID)
		}
	}
	if t.TradeID > a.lastTradeID {
		a.lastTradeID = t.TradeID
	}

	// Bin
	bin := BinPriceLow(t.Price, a.TickSize, a.Comp)

	// Accumulate
	cell, ok := a.cells[bin]
	if !ok {
		cell = &ClusterCell{Price: bin}
		a.cells[bin] = cell
	}

	if t.IsBuyerMaker {
		cell.Bid += t.Qty
	} else {
		cell.Ask += t.Qty
	}

	return gapStart, gapEnd, hasGap
}

// Flush reads all accumulated cells, rounds to 0.1, and returns
// the finalized ClusterCell slice sorted by price. Clears internal state.
func (a *Aggregator) Flush() []ClusterCell {
	cells := make([]ClusterCell, 0, len(a.cells))
	for _, c := range a.cells {
		cells = append(cells, ClusterCell{
			Price: c.Price,
			Bid:   RoundHalfUp(c.Bid),
			Ask:   RoundHalfUp(c.Ask),
		})
	}
	sort.Slice(cells, func(i, j int) bool {
		return cells[i].Price < cells[j].Price
	})
	// Reset
	a.cells = make(map[float64]*ClusterCell)
	a.seen = make(map[int64]bool)
	a.lastTradeID = 0
	return cells
}

// Cells returns a snapshot of current cells (for live reads without flush).
func (a *Aggregator) Cells() []ClusterCell {
	cells := make([]ClusterCell, 0, len(a.cells))
	for _, c := range a.cells {
		cells = append(cells, ClusterCell{
			Price: c.Price,
			Bid:   RoundHalfUp(c.Bid),
			Ask:   RoundHalfUp(c.Ask),
		})
	}
	sort.Slice(cells, func(i, j int) bool {
		return cells[i].Price < cells[j].Price
	})
	return cells
}

// MergeCells merges base-level cells into a higher compression level.
// groupSize = compressionLevel (e.g. ×2 → 2 base cells per group).
func MergeCells(base []ClusterCell, groupSize uint32, baseTickSize float64, baseComp uint32) []ClusterCell {
	if len(base) == 0 || groupSize == 0 {
		return nil
	}
	newBinSize := float64(groupSize) * float64(baseComp) * baseTickSize

	merged := make(map[float64]*ClusterCell)
	for _, c := range base {
		newBin := math.Floor(c.Price/newBinSize) * newBinSize
		cell, ok := merged[newBin]
		if !ok {
			cell = &ClusterCell{Price: newBin}
			merged[newBin] = cell
		}
		cell.Bid += c.Bid
		cell.Ask += c.Ask
	}

	result := make([]ClusterCell, 0, len(merged))
	for _, c := range merged {
		result = append(result, ClusterCell{
			Price: c.Price,
			Bid:   RoundHalfUp(c.Bid),
			Ask:   RoundHalfUp(c.Ask),
		})
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Price < result[j].Price
	})
	return result
}

// RedisAggKey returns the Redis key for live aggregation of the current candle.
func RedisAggKey(market, symbol, tf string, candleTimeUnix int64) string {
	return fmt.Sprintf("agg:%s:%s:%s:%d", market, symbol, tf, candleTimeUnix)
}

// RedisCacheKey returns the Redis key for the last-700 candle cache.
func RedisCacheKey(market, symbol, tf string) string {
	return fmt.Sprintf("cache:%s:%s:%s", market, symbol, tf)
}

// RedisZipKey returns the Redis key for higher compression level cache.
func RedisZipKey(market, symbol, tf string, level uint32) string {
	return fmt.Sprintf("cache:zip:%s:%s:%s:%d", market, symbol, tf, level)
}

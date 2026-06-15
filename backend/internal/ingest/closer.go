package ingest

import (
	"context"
	"log"
	"time"

	"procluster-backend/internal/aggregate"
	"procluster-backend/internal/cache"
	"procluster-backend/internal/store"
)

// CloseFunc is called when a candle is closed, with the cells and metadata.
type CloseFunc func(market, symbol, tf string, candleTimeUnix int64, cells []aggregate.ClusterCell)

// CandleCloserConfig holds the configuration for a CandleCloser.
type CandleCloserConfig struct {
	Symbol      string
	Market      string
	Timeframe   string
	TickSize    float64
	Compression uint32
}

// CandleCloser periodically closes candles and flushes to ClickHouse + cache.
type CandleCloser struct {
	cfg      CandleCloserConfig
	agg      *aggregate.Aggregator
	ch       *store.ClickHouse
	rdb      *cache.RedisCache
	interval time.Duration
	onClose  CloseFunc
}

// NewCandleCloser creates a new closer.
func NewCandleCloser(cfg CandleCloserConfig, agg *aggregate.Aggregator, ch *store.ClickHouse, rdb *cache.RedisCache) *CandleCloser {
	secs := aggregate.TfSeconds[cfg.Timeframe]
	return &CandleCloser{
		cfg:      cfg,
		agg:      agg,
		ch:       ch,
		rdb:      rdb,
		interval: time.Duration(secs) * time.Second,
	}
}

// SetOnClose sets the callback for candle close events.
func (cl *CandleCloser) SetOnClose(fn CloseFunc) {
	cl.onClose = fn
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
		next := nextCloseTime(time.Now(), cl.cfg.Timeframe)
		wait := time.Until(next)
		if wait < 0 {
			wait = 0
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}

		time.Sleep(200 * time.Millisecond)

		candleTimeUnix := next.Unix()
		cacheKey := aggregate.RedisCacheKey(cl.cfg.Market, cl.cfg.Symbol, cl.cfg.Timeframe)
		liveKey := aggregate.RedisAggKey(cl.cfg.Market, cl.cfg.Symbol, cl.cfg.Timeframe, candleTimeUnix)

		cells := cl.agg.Flush()
		if len(cells) == 0 {
			continue
		}

		// Filter out empty cells (price=0, bid=0, ask=0)
		filtered := cells[:0]
		for _, cell := range cells {
			if cell.Price != 0 || cell.Bid != 0 || cell.Ask != 0 {
				filtered = append(filtered, cell)
			}
		}
		cells = filtered
		if len(cells) == 0 {
			continue
		}

		rows := make([]store.ClusterRow, len(cells))
		for i, cell := range cells {
			rows[i] = store.ClusterRow{
				Symbol:     cl.cfg.Symbol,
				Timeframe:  cl.cfg.Timeframe,
				CandleTime: candleTimeUnix,
				Price:      cell.Price,
				Bid:        cell.Bid,
				Ask:        cell.Ask,
			}
		}

		if err := cl.ch.BatchInsert(cl.cfg.Market, rows); err != nil {
			log.Printf("[closer] batch insert error: %v", err)
			continue
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
			candle.Close = cell.Price + float64(cl.cfg.Compression)*cl.cfg.TickSize
		}

		if err := cl.rdb.SetLastCandle(ctx, cacheKey, candle); err != nil {
			log.Printf("[closer] set cache error: %v", err)
		}

		if err := cl.rdb.DelAggKey(ctx, liveKey); err != nil {
			log.Printf("[closer] del live key error: %v", err)
		}

		// Notify WS hub of candle close
		if cl.onClose != nil {
			go cl.onClose(cl.cfg.Market, cl.cfg.Symbol, cl.cfg.Timeframe, candleTimeUnix, cells)
		}

		log.Printf("[closer] closed candle %s %s %s at %d, %d cells",
			cl.cfg.Market, cl.cfg.Symbol, cl.cfg.Timeframe, candleTimeUnix, len(cells))
	}
}

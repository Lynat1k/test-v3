package store

import (
	"context"
	"fmt"
	"sort"

	"procluster-backend/internal/aggregate"
)

// QueryCandles reads cluster rows from ClickHouse and groups them into ClusterCandles.
// beforeSec: if > 0, only candles with candle_time < beforeSec (unix seconds)
// maxCandles: max number of candles to return
func (ch *ClickHouse) QueryCandles(ctx context.Context, market, symbol, tf string, beforeSec int64, maxCandles int) ([]aggregate.ClusterCandle, error) {
	table := "clusters_futures"
	if market == "spot" {
		table = "clusters_spot"
	}

	rowLimit := maxCandles * 50

	query := fmt.Sprintf(`
		SELECT
			toInt64(candle_time) as ts,
			toFloat64(price) as price,
			toFloat64(bid) as bid,
			toFloat64(ask) as ask,
			toFloat64(open_price) as open_price,
			toFloat64(close_price) as close_price
		FROM %s
		WHERE symbol = ? AND timeframe = ?
	`, table)

	var args []interface{}
	args = append(args, symbol, tf)

	if beforeSec > 0 {
		query += " AND candle_time < fromUnixTimestamp(?)"
		args = append(args, beforeSec)
	}

	query += " ORDER BY candle_time DESC LIMIT ?"
	args = append(args, uint32(rowLimit))

	rows, err := ch.conn.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query candles (table=%s sym=%s tf=%s before=%d limit=%d): %w", table, symbol, tf, beforeSec, rowLimit, err)
	}
	defer rows.Close()

	type candleAcc struct {
		candle      aggregate.ClusterCandle
		maxVol      float64
		pocIdx      int
		openPrice   float64
		closePrice  float64
		hasOpen     bool
	}

	candleMap := make(map[int64]*candleAcc)
	var candleOrder []int64

	for rows.Next() {
		var ts int64
		var price, bid, ask, openPrice, closePrice float64
		if err := rows.Scan(&ts, &price, &bid, &ask, &openPrice, &closePrice); err != nil {
			return nil, fmt.Errorf("scan candle row: %w", err)
		}

		acc, ok := candleMap[ts]
		if !ok {
			acc = &candleAcc{}
			acc.candle.Time = ts
			candleMap[ts] = acc
			candleOrder = append(candleOrder, ts)
		}

		cell := aggregate.ClusterCell{Price: price, Bid: bid, Ask: ask}
		vol := bid + ask
		acc.candle.Cells = append(acc.candle.Cells, cell)
		acc.candle.Volume += vol
		acc.candle.Delta += ask - bid
		if vol > acc.maxVol {
			acc.maxVol = vol
		}

		// Track open/close from first row seen per candle (all rows have same open/close)
		if !acc.hasOpen {
			acc.openPrice = openPrice
			acc.closePrice = closePrice
			acc.hasOpen = true
		}
	}

	candles := make([]aggregate.ClusterCandle, 0, len(candleOrder))
	for _, ts := range candleOrder {
		acc := candleMap[ts]
		cc := &acc.candle

		sort.Slice(cc.Cells, func(i, j int) bool {
			return cc.Cells[i].Price < cc.Cells[j].Price
		})

		if len(cc.Cells) > 0 {
			cc.Low = cc.Cells[0].Price
			cc.High = cc.Cells[len(cc.Cells)-1].Price

			// Use real open/close from trade data if available
			if acc.openPrice > 0 {
				cc.Open = acc.openPrice
			} else {
				cc.Open = cc.Low
			}
			if acc.closePrice > 0 {
				cc.Close = acc.closePrice
			} else {
				cc.Close = cc.High
			}
		}

		cc.Volume = round1(cc.Volume)
		cc.Delta = round1(cc.Delta)

		candles = append(candles, *cc)
	}

	// Reverse to ascending order (oldest first)
	for i, j := 0, len(candles)-1; i < j; i, j = i+1, j-1 {
		candles[i], candles[j] = candles[j], candles[i]
	}

	return candles, nil
}

// QueryTickerConfigs reads all enabled ticker configs from ClickHouse.
// Uses FINAL to deduplicate ReplacingMergeTree rows.
func (ch *ClickHouse) QueryTickerConfigs(ctx context.Context) ([]aggregate.TickerConfig, error) {
	query := `
		SELECT symbol, market, toFloat64(tick_size), base_compression,
		       compression_levels, default_compression, ttl_days,
		       dom_snapshot_seconds, enabled
		FROM ticker_config FINAL
		WHERE enabled = 1
	`

	rows, err := ch.conn.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("query ticker configs: %w", err)
	}
	defer rows.Close()

	var configs []aggregate.TickerConfig
	for rows.Next() {
		var tc aggregate.TickerConfig
		var tickSize float64
		var market string
		var enabled uint8
		if err := rows.Scan(
			&tc.Symbol, &market, &tickSize, &tc.BaseCompression,
			&tc.CompressionLevels, &tc.DefaultCompression, &tc.TTLDays,
			&tc.DOMSnapshotSec, &enabled,
		); err != nil {
			return nil, fmt.Errorf("scan ticker config: %w", err)
		}
		tc.Market = market
		tc.TickSize = tickSize
		tc.Enabled = enabled == 1
		configs = append(configs, tc)
	}
	return configs, nil
}

func round1(v float64) float64 {
	return float64(int(v*10+0.5)) / 10
}

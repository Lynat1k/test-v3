package store

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/shopspring/decimal"

	"procluster-backend/internal/aggregate"
)

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
	opts, err := clickhouse.ParseDSN(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse dsn: %w", err)
	}
	opts.Auth.Database = "procluster"
	conn, err := clickhouse.Open(opts)
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

// ApplyMigrations reads and executes the migration SQL file.
// The INSERT INTO ticker_config is made idempotent: only seeds if table is empty.
func (ch *ClickHouse) ApplyMigrations(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read migration: %w", err)
	}
	ctx := context.Background()

	// Check if ticker_config already has data
	var count uint64
	if err := ch.conn.QueryRow(ctx, "SELECT count() FROM ticker_config").Scan(&count); err != nil {
		count = 0
	}

	for _, stmt := range strings.Split(string(data), ";") {
		stmt = strings.TrimSpace(stmt)
		if stmt == "" {
			continue
		}
		// Skip INSERT INTO ticker_config if table already has rows
		if count > 0 && strings.Contains(strings.ToUpper(stmt), "INSERT INTO") &&
			strings.Contains(strings.ToUpper(stmt), "TICKER_CONFIG") {
			continue
		}
		if err := ch.conn.Exec(ctx, stmt); err != nil {
			return fmt.Errorf("migration exec: %w\nstmt: %s", err, stmt)
		}
	}

	// One-time cleanup: deduplicate ticker_config by deleting duplicates
	if err := ch.deduplicateTickerConfig(ctx); err != nil {
		log.Printf("warning: deduplicate ticker_config: %v", err)
	}

	return nil
}

// deduplicateTickerConfig removes duplicate rows keeping the one with latest updated_at.
func (ch *ClickHouse) deduplicateTickerConfig(ctx context.Context) error {
	// ReplacingMergeTree deduplicates on FINAL, but we need to force it.
	// Simplest: count unique vs total, if different → optimize table.
	var total, unique uint64
	if err := ch.conn.QueryRow(ctx, "SELECT count() FROM ticker_config").Scan(&total); err != nil {
		return err
	}
	if err := ch.conn.QueryRow(ctx, "SELECT count() FROM ticker_config FINAL").Scan(&unique); err != nil {
		return err
	}
	if total > unique {
		log.Printf("ticker_config: %d total rows, %d unique — deduplicating", total, unique)
		if err := ch.conn.Exec(ctx, "OPTIMIZE TABLE ticker_config FINAL"); err != nil {
			return fmt.Errorf("optimize: %w", err)
		}
	}
	return nil
}

// Ping checks ClickHouse connectivity.
func (ch *ClickHouse) Ping() error {
	return ch.conn.Ping(context.Background())
}

// TickerConfigRow is used for upsert operations.
type TickerConfigRow struct {
	Symbol             string
	Market             string
	TickSize           float64
	BaseCompression    uint32
	CompressionLevels  uint8
	DefaultCompression uint32
	TTLDays            uint32
	DOMSnapshotSec     uint32
	Enabled            bool
}

// UpsertTickerConfig inserts or replaces a ticker config row.
func (ch *ClickHouse) UpsertTickerConfig(ctx context.Context, row TickerConfigRow) error {
	enabled := uint8(0)
	if row.Enabled {
		enabled = 1
	}
	query := `INSERT INTO ticker_config (symbol, market, tick_size, base_compression, compression_levels, default_compression, ttl_days, dom_snapshot_seconds, enabled)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
	return ch.conn.Exec(ctx, query,
		row.Symbol, row.Market, row.TickSize, row.BaseCompression,
		row.CompressionLevels, row.DefaultCompression, row.TTLDays,
		row.DOMSnapshotSec, enabled,
	)
}

// DeleteTickerConfig removes a ticker config by symbol+market.
func (ch *ClickHouse) DeleteTickerConfig(ctx context.Context, symbol, market string) error {
	query := `ALTER TABLE ticker_config DELETE WHERE symbol = ? AND market = ?`
	return ch.conn.Exec(ctx, query, symbol, market)
}

// QueryTickerConfigsAll reads all ticker configs (including disabled).
func (ch *ClickHouse) QueryTickerConfigsAll(ctx context.Context) ([]aggregate.TickerConfig, error) {
	query := `
		SELECT symbol, market, toFloat64(tick_size), base_compression,
		       compression_levels, default_compression, ttl_days,
		       dom_snapshot_seconds, enabled
		FROM ticker_config FINAL
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

func toDecimal18(v float64) decimal.Decimal {
	return decimal.NewFromFloat(v).Round(1)
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
			toDecimal18(r.Price),
			toDecimal18(r.Bid),
			toDecimal18(r.Ask),
		); err != nil {
			return fmt.Errorf("batch append: %w", err)
		}
	}

	return batch.Send()
}

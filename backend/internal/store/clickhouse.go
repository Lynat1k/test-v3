package store

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
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
func (ch *ClickHouse) ApplyMigrations(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read migration: %w", err)
	}
	ctx := context.Background()
	for _, stmt := range strings.Split(string(data), ";") {
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

package store

import (
	"os"
	"testing"
)

func TestNewClickHouse(t *testing.T) {
	dsn := "clickhouse://localhost:9000"
	ch, err := NewClickHouse(dsn)
	if err != nil {
		t.Skipf("ClickHouse not available: %v", err)
	}
	defer ch.Close()
	if ch.conn == nil {
		t.Fatal("conn is nil")
	}
}

func TestApplyMigrations(t *testing.T) {
	dsn := "clickhouse://localhost:9000"
	ch, err := NewClickHouse(dsn)
	if err != nil {
		t.Skipf("ClickHouse not available: %v", err)
	}
	defer ch.Close()

	migrationsPath := "../../migrations/001_init.sql"
	if _, err := os.Stat(migrationsPath); os.IsNotExist(err) {
		t.Skipf("Migration file not found: %v", err)
	}

	err = ch.ApplyMigrations(migrationsPath)
	if err != nil {
		t.Fatalf("ApplyMigrations failed: %v", err)
	}
}

func TestBatchInsertClusters(t *testing.T) {
	dsn := "clickhouse://localhost:9000"
	ch, err := NewClickHouse(dsn)
	if err != nil {
		t.Skipf("ClickHouse not available: %v", err)
	}
	defer ch.Close()

	rows := []ClusterRow{
		{
			Symbol:     "BTCUSDT",
			Timeframe:  "1m",
			CandleTime: 1718361600,
			Price:      100.0,
			Bid:        1.5,
			Ask:        2.0,
		},
	}
	err = ch.BatchInsert("futures", rows)
	if err != nil {
		t.Fatalf("BatchInsert failed: %v", err)
	}
}

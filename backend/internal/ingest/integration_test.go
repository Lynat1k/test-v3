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

	cfg := WSConfig{
		Symbol:      "BTCUSDT",
		Market:      "futures",
		TickSize:    0.1,
		Compression: 25,
		Timeframe:   "1m",
		RedisKeyFn: func(tf string, ct int64) string {
			return aggregate.RedisAggKey("futures", "BTCUSDT", tf, ct)
		},
	}
	ws := NewWSClient(cfg)

	go ws.Run(ctx, rdb)

	time.Sleep(60 * time.Second)

	log.Println("Integration test: WS client ran for 60s")
	log.Println("Check ClickHouse clusters_futures for BTCUSDT rows")
}

package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"procluster-backend/internal/aggregate"
	"procluster-backend/internal/cache"
	"procluster-backend/internal/ingest"
	"procluster-backend/internal/store"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8090"
	}
	redisAddr := os.Getenv("REDIS_URL")
	if redisAddr == "" {
		redisAddr = "localhost:6390"
	}
	chAddr := os.Getenv("CLICKHOUSE_URL")
	if chAddr == "" {
		chAddr = "clickhouse://localhost:9090"
	}
	migrationsPath := os.Getenv("MIGRATIONS_PATH")
	if migrationsPath == "" {
		migrationsPath = "migrations/001_init.sql"
	}

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	ch, err := store.NewClickHouse(chAddr)
	if err != nil {
		log.Fatalf("clickhouse: %v", err)
	}
	defer ch.Close()
	if err := ch.ApplyMigrations(migrationsPath); err != nil {
		log.Fatalf("migrations: %v", err)
	}
	log.Println("ClickHouse migrations applied")

	rdb := cache.New(redisAddr)
	defer rdb.Close()
	if err := rdb.Ping(ctx); err != nil {
		log.Fatalf("redis: %v", err)
	}
	log.Println("Redis connected")

	type tickerDef struct {
		symbol string
		market string
		tick   float64
		comp   uint32
		tfs    []string
	}
	tickers := []tickerDef{
		{"BTCUSDT", "futures", 0.1, 25, []string{"1m", "5m", "15m", "30m", "1h", "4h"}},
		{"BTCUSDT", "spot", 0.01, 500, []string{"15m", "30m", "1h", "4h"}},
	}

	for _, td := range tickers {
		for _, tf := range td.tfs {
			tfCopy := tf
			tdCopy := td
			cfg := ingest.WSConfig{
				Symbol:      tdCopy.symbol,
				Market:      tdCopy.market,
				TickSize:    tdCopy.tick,
				Compression: tdCopy.comp,
				Timeframe:   tfCopy,
				RedisKeyFn: func(tf string, ct int64) string {
					return aggregate.RedisAggKey(tdCopy.market, tdCopy.symbol, tf, ct)
				},
			}
			ws := ingest.NewWSClient(cfg)
			go ws.Run(ctx, rdb)

			closer := ingest.NewCandleCloser(ws, ch, rdb, tfCopy)
			go closer.Run(ctx)
		}
	}

	log.Printf("Started ingest for %d ticker(s)", len(tickers))

	http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	log.Printf("Server listening on :%s", port)
	go func() {
		if err := http.ListenAndServe(":"+port, nil); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("Shutting down...")
}

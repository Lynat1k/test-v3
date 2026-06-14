package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"procluster-backend/internal/aggregate"
	"procluster-backend/internal/cache"
	"procluster-backend/internal/history"
	"procluster-backend/internal/ingest"
	"procluster-backend/internal/store"
)

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func runLoadHistory() error {
	symbol := flag.String("symbol", "BTCUSDT", "Trading symbol")
	market := flag.String("market", "futures", "Market: futures or spot")
	fromStr := flag.String("from", "", "Start date (YYYY-MM-DD)")
	toStr := flag.String("to", "", "End date (YYYY-MM-DD)")
	chAddr := flag.String("clickhouse-url", envOr("CLICKHOUSE_URL", "clickhouse://localhost:9090"), "ClickHouse DSN")
	flag.Parse()

	if *fromStr == "" || *toStr == "" {
		return fmt.Errorf("--from and --to are required")
	}

	from, err := time.Parse("2006-01-02", *fromStr)
	if err != nil {
		return fmt.Errorf("invalid --from date: %w", err)
	}
	to, err := time.Parse("2006-01-02", *toStr)
	if err != nil {
		return fmt.Errorf("invalid --to date: %w", err)
	}

	type tickerDef struct {
		tick float64
		comp uint32
		tfs  []string
	}
	tickers := map[string]map[string]tickerDef{
		"BTCUSDT": {
			"futures": {0.1, 25, []string{"1m", "5m", "15m", "30m", "1h", "4h"}},
			"spot":    {0.01, 500, []string{"15m", "30m", "1h", "4h"}},
		},
	}

	sym := strings.ToUpper(*symbol)
	mkt := strings.ToLower(*market)

	td, ok := tickers[sym][mkt]
	if !ok {
		return fmt.Errorf("unknown ticker: %s %s", mkt, sym)
	}

	ch, err := store.NewClickHouse(*chAddr)
	if err != nil {
		return fmt.Errorf("clickhouse: %w", err)
	}
	defer ch.Close()

	cfg := history.HistoryConfig{
		Symbol:      sym,
		Market:      mkt,
		From:        from,
		To:          to,
		TickSize:    td.tick,
		Compression: td.comp,
		Timeframes:  td.tfs,
	}

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	p := history.NewPipeline(ch, nil)
	return p.Run(ctx, cfg)
}

func runServer() {
	port := envOr("PORT", "8090")
	redisAddr := envOr("REDIS_URL", "localhost:6390")
	chAddr := envOr("CLICKHOUSE_URL", "clickhouse://localhost:9090")
	migrationsPath := envOr("MIGRATIONS_PATH", "migrations/001_init.sql")

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

func main() {
	if len(os.Args) > 1 && os.Args[1] == "loadhistory" {
		os.Args = append(os.Args[:1], os.Args[2:]...)
		if err := runLoadHistory(); err != nil {
			log.Fatalf("loadhistory: %v", err)
		}
		return
	}

	runServer()
}

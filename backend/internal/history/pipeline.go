package history

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sort"
	"time"

	"procluster-backend/internal/aggregate"
	"procluster-backend/internal/store"
)

// HistoryConfig holds parameters for a history load run.
type HistoryConfig struct {
	Symbol      string
	Market      string // "futures" or "spot"
	From        time.Time
	To          time.Time
	TickSize    float64
	Compression uint32
	Timeframes  []string // e.g. ["1m","5m","15m","30m","1h","4h"] for futures
}

// ProgressFunc is called with progress updates.
type ProgressFunc func(label string, current, total int, detail string)

// Pipeline orchestrates: download → parse CSV → aggregate → insert into CH.
type Pipeline struct {
	ch          *store.ClickHouse
	client      *http.Client
	onProgress  ProgressFunc
}

// NewPipeline creates a new history pipeline.
func NewPipeline(ch *store.ClickHouse, onProgress ProgressFunc) *Pipeline {
	return &Pipeline{
		ch:         ch,
		client:     NewRateLimitedClient(),
		onProgress: onProgress,
	}
}

// Run executes the full history load pipeline.
func (p *Pipeline) Run(ctx context.Context, cfg HistoryConfig) error {
	dates := DateRange(cfg.From, cfg.To)
	totalDays := len(dates)

	log.Printf("History load: %s %s %s → %s (%d days, TFs: %v)",
		cfg.Market, cfg.Symbol, cfg.From.Format("2006-01-02"),
		cfg.To.Format("2006-01-02"), totalDays, cfg.Timeframes)

	var totalTrades, totalInserted int

	for i, date := range dates {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		p.progress("download", i+1, totalDays, date)

		// 1. Download + extract
		csvPath, err := DownloadAndExtract(ctx, cfg.Symbol, cfg.Market, date, tempDir(cfg), p.client)
		if err != nil {
			log.Printf("WARN: skip %s: %v", date, err)
			continue
		}

		// 2. Parse CSV
		trades, err := p.parseCSV(csvPath, cfg.Market)
		if err != nil {
			log.Printf("WARN: parse %s: %v", date, err)
			continue
		}
		totalTrades += len(trades)
		p.progress("parsed", i+1, totalDays, fmt.Sprintf("%d trades", len(trades)))

		// 3. Aggregate per-candle per-TF and insert
		inserted, err := p.aggregateAndInsert(ctx, cfg, trades)
		if err != nil {
			log.Printf("ERROR: aggregate %s: %v", date, err)
			continue
		}
		totalInserted += inserted
		p.progress("insert", i+1, totalDays, fmt.Sprintf("%d cells", inserted))

		// Rate limit between days
		time.Sleep(200 * time.Millisecond)
	}

	log.Printf("History load complete: %d trades → %d cells inserted", totalTrades, totalInserted)
	return nil
}

// parseCSV reads a CSV file and returns sorted, deduplicated trades.
func (p *Pipeline) parseCSV(csvPath string, market string) ([]aggregate.Trade, error) {
	f, err := os.Open(csvPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var parseFn func(io.Reader) ([]aggregate.Trade, error)
	if market == "spot" {
		parseFn = ParseSpotCSV
	} else {
		parseFn = ParseFuturesCSV
	}

	trades, err := parseFn(f)
	if err != nil {
		return nil, err
	}

	// Sort by tradeId + dedup
	sort.Slice(trades, func(i, j int) bool {
		return trades[i].TradeID < trades[j].TradeID
	})
	trades = dedup(trades)

	return trades, nil
}

func dedup(trades []aggregate.Trade) []aggregate.Trade {
	if len(trades) == 0 {
		return trades
	}
	result := []aggregate.Trade{trades[0]}
	for i := 1; i < len(trades); i++ {
		if trades[i].TradeID != trades[i-1].TradeID {
			result = append(result, trades[i])
		}
	}
	return result
}

// candleKey groups trades by (candle_time_unix, tf).
type candleKey struct {
	candleTime int64
	tf         string
}

// aggregateAndInsert groups trades by candle_time for each TF,
// aggregates using the SAME pipeline as realtime, and batch-inserts.
func (p *Pipeline) aggregateAndInsert(ctx context.Context, cfg HistoryConfig, trades []aggregate.Trade) (int, error) {
	// Build per-(candleTime, tf) aggregators lazily
	aggMap := make(map[candleKey]*aggregate.Aggregator)
	totalCells := 0

	for _, t := range trades {
		for _, tf := range cfg.Timeframes {
			ct := aggregate.CandleTimeUnix(t.TradeTimeMs, tf)
			key := candleKey{candleTime: ct, tf: tf}

		agg, ok := aggMap[key]
		if !ok {
			agg = aggregate.NewAggregator(cfg.Symbol, cfg.Market, tf, cfg.TickSize, cfg.Compression)
			aggMap[key] = agg
		}
			agg.ProcessTrade(t)
		}
	}

	// Collect all rows for batch insert
	var allRows []store.ClusterRow

	for key, agg := range aggMap {
		cells := agg.Flush()
		if len(cells) == 0 {
			continue
		}
		openPrice := agg.OpenPrice()
		closePrice := agg.ClosePrice()
		for _, c := range cells {
			allRows = append(allRows, store.ClusterRow{
				Symbol:     cfg.Symbol,
				Timeframe:  key.tf,
				CandleTime: key.candleTime,
				Price:      c.Price,
				Bid:        c.Bid,
				Ask:        c.Ask,
				OpenPrice:  openPrice,
				ClosePrice: closePrice,
			})
		}
		totalCells += len(cells)
	}

	if len(allRows) == 0 {
		return 0, nil
	}

	// Batch insert (idempotent via ReplacingMergeTree)
	if err := p.ch.BatchInsert(cfg.Market, allRows); err != nil {
		return 0, fmt.Errorf("batch insert: %w", err)
	}

	return totalCells, nil
}

func tempDir(cfg HistoryConfig) string {
	return fmt.Sprintf("data/history/%s/%s", cfg.Market, cfg.Symbol)
}

func (p *Pipeline) progress(label string, current, total int, detail string) {
	if p.onProgress != nil {
		p.onProgress(label, current, total, detail)
	} else {
		LogProgress(label, current, total, detail)
	}
}

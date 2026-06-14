package aggregate

import (
	"testing"
)

func TestProcessTrade_BidAsk(t *testing.T) {
	// S1: isBuyerMaker=true → bid
	a := NewAggregator("BTCUSDT", "futures", "1m", 0.1, 25)
	a.ProcessTrade(Trade{TradeID: 1, Price: 100.0, Qty: 0.5, IsBuyerMaker: true})
	cells := a.Cells()
	if len(cells) != 1 {
		t.Fatalf("expected 1 cell, got %d", len(cells))
	}
	if cells[0].Bid != 0.5 {
		t.Errorf("S1: bid=%v, want 0.5", cells[0].Bid)
	}
	if cells[0].Ask != 0 {
		t.Errorf("S1: ask=%v, want 0", cells[0].Ask)
	}

	// S2: isBuyerMaker=false → ask
	a2 := NewAggregator("BTCUSDT", "futures", "1m", 0.1, 25)
	a2.ProcessTrade(Trade{TradeID: 2, Price: 100.0, Qty: 1.2, IsBuyerMaker: false})
	cells2 := a2.Cells()
	if cells2[0].Ask != 1.2 {
		t.Errorf("S2: ask=%v, want 1.2", cells2[0].Ask)
	}
	if cells2[0].Bid != 0 {
		t.Errorf("S2: bid=%v, want 0", cells2[0].Bid)
	}

	// S3: bid only
	a3 := NewAggregator("BTCUSDT", "futures", "1m", 0.1, 25)
	a3.ProcessTrade(Trade{TradeID: 3, Price: 100.0, Qty: 0.5, IsBuyerMaker: true})
	c3 := a3.Cells()
	if c3[0].Bid != 0.5 || c3[0].Ask != 0 {
		t.Errorf("S3: bid=%v ask=%v, want bid=0.5 ask=0", c3[0].Bid, c3[0].Ask)
	}

	// S4: ask only
	a4 := NewAggregator("BTCUSDT", "futures", "1m", 0.1, 25)
	a4.ProcessTrade(Trade{TradeID: 4, Price: 100.0, Qty: 1.2, IsBuyerMaker: false})
	c4 := a4.Cells()
	if c4[0].Bid != 0 || c4[0].Ask != 1.2 {
		t.Errorf("S4: bid=%v ask=%v, want bid=0 ask=1.2", c4[0].Bid, c4[0].Ask)
	}
}

func TestProcessTrade_SortAndDedup(t *testing.T) {
	// D1: trades arrive out of order by tradeId, must sort
	a := NewAggregator("BTCUSDT", "futures", "1m", 0.1, 25)
	a.ProcessTrade(Trade{TradeID: 3, Price: 100.0, Qty: 1.0, IsBuyerMaker: true})
	a.ProcessTrade(Trade{TradeID: 1, Price: 100.0, Qty: 2.0, IsBuyerMaker: false})
	a.ProcessTrade(Trade{TradeID: 2, Price: 100.0, Qty: 0.5, IsBuyerMaker: true})

	cells := a.Flush()
	// All three go to same bin, bid=1.5 (trade 3+2), ask=2.0 (trade 1)
	if len(cells) != 1 {
		t.Fatalf("D1: expected 1 cell, got %d", len(cells))
	}
	if diff := cells[0].Bid - 1.5; diff > 0.001 || diff < -0.001 {
		t.Errorf("D1: bid=%v, want 1.5", cells[0].Bid)
	}
	if diff := cells[0].Ask - 2.0; diff > 0.001 || diff < -0.001 {
		t.Errorf("D1: ask=%v, want 2.0", cells[0].Ask)
	}

	// D2: duplicate tradeId → second skipped
	a2 := NewAggregator("BTCUSDT", "futures", "1m", 0.1, 25)
	a2.ProcessTrade(Trade{TradeID: 1, Price: 100.0, Qty: 1.0, IsBuyerMaker: true})
	a2.ProcessTrade(Trade{TradeID: 1, Price: 100.0, Qty: 1.0, IsBuyerMaker: true})
	c2 := a2.Flush()
	if c2[0].Bid != 1.0 {
		t.Errorf("D2: bid=%v, want 1.0 (dedup)", c2[0].Bid)
	}

	// D4: 100 sequential trades
	a4 := NewAggregator("BTCUSDT", "futures", "1m", 0.1, 25)
	for i := int64(1); i <= 100; i++ {
		a4.ProcessTrade(Trade{TradeID: i, Price: 100.0, Qty: 0.1, IsBuyerMaker: i%2 == 0})
	}
	c4 := a4.Flush()
	if len(c4) != 1 {
		t.Fatalf("D4: expected 1 cell, got %d", len(c4))
	}
	if diff := c4[0].Bid - 5.0; diff > 0.01 || diff < -0.01 {
		t.Errorf("D4: bid=%v, want 5.0", c4[0].Bid)
	}
	if diff := c4[0].Ask - 5.0; diff > 0.01 || diff < -0.01 {
		t.Errorf("D4: ask=%v, want 5.0", c4[0].Ask)
	}
}

func TestCandleTime(t *testing.T) {
	tests := []struct {
		name       string
		tradeMs    int64
		tf         string
		expectedMs int64
	}{
		{"T1: 1718361630s 1m → 1718361600", 1718361630000, "1m", 1718361600},
		{"T2: 1718361659s 1m → 1718361600", 1718361659000, "1m", 1718361600},
		{"T3: 1718361660s 1m → 1718361660", 1718361660000, "1m", 1718361660},
		{"T4: 1718361600s 5m → 1718361600", 1718361600000, "5m", 1718361600},
		{"T5: 1718361800s 5m → 1718361600", 1718361800000, "5m", 1718361600},
		{"T6: 1718361901s 5m → 1718361900", 1718361901000, "5m", 1718361900},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CandleTimeUnix(tt.tradeMs, tt.tf)
			if got != tt.expectedMs {
				t.Errorf("CandleTimeUnix(%d, %q) = %d, want %d",
					tt.tradeMs, tt.tf, got, tt.expectedMs)
			}
		})
	}
}

func TestFlushClearsState(t *testing.T) {
	a := NewAggregator("BTCUSDT", "futures", "1m", 0.1, 25)
	a.ProcessTrade(Trade{TradeID: 1, Price: 100.0, Qty: 1.0, IsBuyerMaker: true})
	_ = a.Flush()

	// After flush, new trades start fresh
	a.ProcessTrade(Trade{TradeID: 2, Price: 200.0, Qty: 0.5, IsBuyerMaker: false})
	cells := a.Flush()
	if len(cells) != 1 {
		t.Fatalf("expected 1 cell after flush, got %d", len(cells))
	}
	if cells[0].Price != 200.0 {
		t.Errorf("price=%v, want 200.0", cells[0].Price)
	}
}

func TestRedisKeys(t *testing.T) {
	key := RedisAggKey("futures", "BTCUSDT", "1m", 1718361600)
	if key != "agg:futures:BTCUSDT:1m:1718361600" {
		t.Errorf("RedisAggKey = %q", key)
	}

	cacheKey := RedisCacheKey("futures", "BTCUSDT", "1m")
	if cacheKey != "cache:futures:BTCUSDT:1m" {
		t.Errorf("RedisCacheKey = %q", cacheKey)
	}

	zipKey := RedisZipKey("futures", "BTCUSDT", "1m", 2)
	if zipKey != "cache:zip:futures:BTCUSDT:1m:2" {
		t.Errorf("RedisZipKey = %q", zipKey)
	}
}

func TestMergeCells(t *testing.T) {
	// ×2 merge: 2 base cells per group
	base := []ClusterCell{
		{Price: 100.0, Bid: 1.0, Ask: 2.0},
		{Price: 102.5, Bid: 3.0, Ask: 4.0},
		{Price: 105.0, Bid: 5.0, Ask: 6.0},
		{Price: 107.5, Bid: 7.0, Ask: 8.0},
	}

	// baseTickSize=0.1, baseComp=25 → baseBinSize=2.5
	// ×2 → newBinSize = 2 * 25 * 0.1 = 5.0
	merged := MergeCells(base, 2, 0.1, 25)
	if len(merged) != 2 {
		t.Fatalf("expected 2 merged cells, got %d", len(merged))
	}

	// First group: 100.0 + 102.5 → bin 100.0
	if merged[0].Price != 100.0 {
		t.Errorf("merged[0].Price = %v, want 100.0", merged[0].Price)
	}
	if diff := merged[0].Bid - 4.0; diff > 0.01 || diff < -0.01 {
		t.Errorf("merged[0].Bid = %v, want 4.0", merged[0].Bid)
	}
	if diff := merged[0].Ask - 6.0; diff > 0.01 || diff < -0.01 {
		t.Errorf("merged[0].Ask = %v, want 6.0", merged[0].Ask)
	}

	// Second group: 105.0 + 107.5 → bin 105.0
	if merged[1].Price != 105.0 {
		t.Errorf("merged[1].Price = %v, want 105.0", merged[1].Price)
	}
	if diff := merged[1].Bid - 12.0; diff > 0.01 || diff < -0.01 {
		t.Errorf("merged[1].Bid = %v, want 12.0", merged[1].Bid)
	}
}

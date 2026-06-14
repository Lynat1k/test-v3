package history

import (
	"strings"
	"testing"
	"time"
)

func TestParseFuturesCSV(t *testing.T) {
	// Real Binance futures trades from data.binance.vision (comma-delimited with header):
	// id,price,qty,quote_qty,time,is_buyer_maker
	csv := `id,price,qty,quote_qty,time,is_buyer_maker
5793017800,93548.8,0.036,3367.7568,1735689600051,false
5793017801,93548.8,0.02,1870.976,1735689600051,false
5793017802,93548.7,0.002,187.0974,1735689605048,true`

	trades, err := ParseFuturesCSV(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("ParseFuturesCSV error: %v", err)
	}
	if len(trades) != 3 {
		t.Fatalf("expected 3 trades, got %d", len(trades))
	}

	// Trade 1
	if trades[0].TradeID != 5793017800 {
		t.Errorf("trade[0].TradeID = %d, want 5793017800", trades[0].TradeID)
	}
	if trades[0].Price != 93548.8 {
		t.Errorf("trade[0].Price = %v, want 93548.8", trades[0].Price)
	}
	if trades[0].Qty != 0.036 {
		t.Errorf("trade[0].Qty = %v, want 0.036", trades[0].Qty)
	}
	if trades[0].TradeTimeMs != 1735689600051 {
		t.Errorf("trade[0].TradeTimeMs = %d, want 1735689600051", trades[0].TradeTimeMs)
	}
	if trades[0].IsBuyerMaker {
		t.Errorf("trade[0].IsBuyerMaker = true, want false")
	}

	// Trade 3 — is_buyer_maker=true
	if trades[2].TradeID != 5793017802 {
		t.Errorf("trade[2].TradeID = %d, want 5793017802", trades[2].TradeID)
	}
	if !trades[2].IsBuyerMaker {
		t.Errorf("trade[2].IsBuyerMaker = false, want true")
	}
}

func TestParseSpotCSV(t *testing.T) {
	// Real Binance spot trades from data.binance.vision (comma-delimited with header):
	// id,price,qty,quote_qty,time,is_buyer_maker
	csv := `id,price,qty,quote_qty,time,is_buyer_maker
51175358,17.80180000,5.69000000,101.29224200,1735689600000000,true
51175359,17.80200000,0.10000000,1.78020000,1735689600010000,false
51175360,17.80150000,2.50000000,44.50375000,1735689600020000,true`

	trades, err := ParseSpotCSV(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("ParseSpotCSV error: %v", err)
	}
	if len(trades) != 3 {
		t.Fatalf("expected 3 trades, got %d", len(trades))
	}

	// Trade 1 — microsecond timestamp converted to milliseconds
	if trades[0].TradeID != 51175358 {
		t.Errorf("trade[0].TradeID = %d, want 51175358", trades[0].TradeID)
	}
	if trades[0].Price != 17.8018 {
		t.Errorf("trade[0].Price = %v, want 17.8018", trades[0].Price)
	}
	if trades[0].Qty != 5.69 {
		t.Errorf("trade[0].Qty = %v, want 5.69", trades[0].Qty)
	}
	// 1735689600000000 us → 1735689600000 ms
	expectedMs := int64(1735689600000)
	if trades[0].TradeTimeMs != expectedMs {
		t.Errorf("trade[0].TradeTimeMs = %d, want %d", trades[0].TradeTimeMs, expectedMs)
	}
	if !trades[0].IsBuyerMaker {
		t.Errorf("trade[0].IsBuyerMaker = false, want true")
	}

	// Trade 2 — isBuyerMaker=false → ask
	if trades[1].IsBuyerMaker {
		t.Errorf("trade[1].IsBuyerMaker = true, want false")
	}
}

func TestParseFuturesCSV_SkipsBadLines(t *testing.T) {
	csv := `id,price,qty,quote_qty,time,is_buyer_maker
5793017800,93548.8,0.036,3367.7568,1735689600051,false
BAD_LINE
5793017802,93548.7,0.002,187.0974,1735689605048,true`

	trades, err := ParseFuturesCSV(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(trades) != 2 {
		t.Errorf("expected 2 trades (bad line skipped), got %d", len(trades))
	}
}

func TestParseFuturesCSV_EmptyInput(t *testing.T) {
	trades, err := ParseFuturesCSV(strings.NewReader(""))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(trades) != 0 {
		t.Errorf("expected 0 trades, got %d", len(trades))
	}
}

func TestParseSpotCSV_OldFormat_Milliseconds(t *testing.T) {
	// Old spot format: timestamp already in milliseconds (< 1e15)
	csv := `id,price,qty,quote_qty,time,is_buyer_maker
51175358,17.80180000,5.69000000,101.29224200,1735689600108,true`

	trades, err := ParseSpotCSV(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(trades) != 1 {
		t.Fatalf("expected 1 trade, got %d", len(trades))
	}
	// 1735689600108 < 1e15, so treated as milliseconds directly
	if trades[0].TradeTimeMs != 1735689600108 {
		t.Errorf("TradeTimeMs = %d, want 1735689600108 (no division)", trades[0].TradeTimeMs)
	}
}

func TestParseSpotCSV_TooFewColumns(t *testing.T) {
	csv := `id,price,qty
28457,4.00000100,12.00000000`
	trades, err := ParseSpotCSV(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(trades) != 0 {
		t.Errorf("expected 0 trades (too few columns), got %d", len(trades))
	}
}

func TestDateRange(t *testing.T) {
	from := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2025, 1, 3, 0, 0, 0, 0, time.UTC)
	dates := DateRange(from, to)
	if len(dates) != 3 {
		t.Fatalf("expected 3 dates, got %d", len(dates))
	}
	if dates[0] != "2025-01-01" || dates[1] != "2025-01-02" || dates[2] != "2025-01-03" {
		t.Errorf("dates = %v", dates)
	}
}

func TestDateRange_SingleDay(t *testing.T) {
	d := time.Date(2025, 6, 14, 0, 0, 0, 0, time.UTC)
	dates := DateRange(d, d)
	if len(dates) != 1 || dates[0] != "2025-06-14" {
		t.Errorf("expected [2025-06-14], got %v", dates)
	}
}

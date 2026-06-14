package history

import (
	"strings"
	"testing"
	"time"
)

func TestParseFuturesCSV(t *testing.T) {
	// Real Binance futures trades from data.binance.vision:
	// comma-delimited WITH header row, 6 columns
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
	if !trades[2].IsBuyerMaker {
		t.Errorf("trade[2].IsBuyerMaker = false, want true")
	}
}

func TestParseSpotCSV(t *testing.T) {
	// Real Binance spot trades from data.binance.vision:
	// comma-delimited, NO header row, 7 columns (is_best_match is 7th)
	csv := `4361451942,94591.78000000,0.00015000,14.18876700,1735776000113701,True,True
4361451943,94591.78000000,0.00181000,171.21112180,1735776000174250,True,True
4361451944,94591.79000000,0.00092000,87.02444680,1735776000539055,False,True`

	trades, err := ParseSpotCSV(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("ParseSpotCSV error: %v", err)
	}
	if len(trades) != 3 {
		t.Fatalf("expected 3 trades, got %d", len(trades))
	}

	// Trade 1 — microsecond timestamp converted to milliseconds
	if trades[0].TradeID != 4361451942 {
		t.Errorf("trade[0].TradeID = %d, want 4361451942", trades[0].TradeID)
	}
	if trades[0].Price != 94591.78 {
		t.Errorf("trade[0].Price = %v, want 94591.78", trades[0].Price)
	}
	if trades[0].Qty != 0.00015 {
		t.Errorf("trade[0].Qty = %v, want 0.00015", trades[0].Qty)
	}
	// 1735776000113701 us → 1735776000113 ms
	expectedMs := int64(1735776000113)
	if trades[0].TradeTimeMs != expectedMs {
		t.Errorf("trade[0].TradeTimeMs = %d, want %d", trades[0].TradeTimeMs, expectedMs)
	}
	if !trades[0].IsBuyerMaker {
		t.Errorf("trade[0].IsBuyerMaker = false, want true")
	}

	// Trade 3 — isBuyerMaker=False
	if trades[2].IsBuyerMaker {
		t.Errorf("trade[2].IsBuyerMaker = true, want false")
	}
}

func TestParseSpotCSV_NoHeaderRow(t *testing.T) {
	// Spot has NO header — first line must be parsed as data
	csv := `12345,100.5,1.0,100.5,1735776000113701,True,True`
	trades, err := ParseSpotCSV(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(trades) != 1 {
		t.Fatalf("expected 1 trade, got %d", len(trades))
	}
	if trades[0].TradeID != 12345 {
		t.Errorf("TradeID = %d, want 12345", trades[0].TradeID)
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

func TestParseSpotCSV_TooFewColumns(t *testing.T) {
	csv := `12345,100.5,1.0`
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

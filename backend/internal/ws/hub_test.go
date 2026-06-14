package ws

import (
	"testing"
)

func TestParseSubKey(t *testing.T) {
	tests := []struct {
		key         string
		market      string
		symbol      string
		tf          string
		compression uint32
	}{
		{"futures:BTCUSDT:1m:25", "futures", "BTCUSDT", "1m", 25},
		{"spot:BTCUSDT:15m:500", "spot", "BTCUSDT", "15m", 500},
		{"futures:BTCUSDT:1m:250", "futures", "BTCUSDT", "1m", 250},
	}

	for _, tt := range tests {
		market, symbol, tf, comp := parseSubKey(tt.key)
		if market != tt.market {
			t.Errorf("parseSubKey(%q) market = %q, want %q", tt.key, market, tt.market)
		}
		if symbol != tt.symbol {
			t.Errorf("parseSubKey(%q) symbol = %q, want %q", tt.key, symbol, tt.symbol)
		}
		if tf != tt.tf {
			t.Errorf("parseSubKey(%q) tf = %q, want %q", tt.key, tf, tt.tf)
		}
		if comp != tt.compression {
			t.Errorf("parseSubKey(%q) compression = %d, want %d", tt.key, comp, tt.compression)
		}
	}
}

func TestSubKeyRoundTrip(t *testing.T) {
	tests := []struct {
		market string
		symbol string
		tf     string
		comp   uint32
	}{
		{"futures", "BTCUSDT", "1m", 25},
		{"spot", "BTCUSDT", "15m", 500},
		{"futures", "BTCUSDT", "1m", 250},
		{"futures", "ETHUSDT", "5m", 100},
	}

	for _, tt := range tests {
		key := subKey(tt.market, tt.symbol, tt.tf, tt.comp)
		market, symbol, tf, comp := parseSubKey(key)
		if market != tt.market || symbol != tt.symbol || tf != tt.tf || comp != tt.comp {
			t.Errorf("roundtrip failed for %s %s %s %d: got %s %s %s %d",
				tt.market, tt.symbol, tt.tf, tt.comp, market, symbol, tf, comp)
		}
	}
}

func TestItoa(t *testing.T) {
	tests := []struct {
		n    uint32
		want string
	}{
		{0, "0"},
		{1, "1"},
		{25, "25"},
		{500, "500"},
		{250, "250"},
	}

	for _, tt := range tests {
		got := itoa(tt.n)
		if got != tt.want {
			t.Errorf("itoa(%d) = %q, want %q", tt.n, got, tt.want)
		}
	}
}

func TestParseU32(t *testing.T) {
	tests := []struct {
		s    string
		want uint32
	}{
		{"0", 0},
		{"1", 1},
		{"25", 25},
		{"500", 500},
		{"250", 250},
		{"abc", 0},
	}

	for _, tt := range tests {
		got := parseU32(tt.s)
		if got != tt.want {
			t.Errorf("parseU32(%q) = %d, want %d", tt.s, got, tt.want)
		}
	}
}

func TestRound1(t *testing.T) {
	tests := []struct {
		in   float64
		want float64
	}{
		{5.1256, 5.1},
		{5.65, 5.7},
		{0.0125, 0.0},
		{0.85, 0.9},
		{99.99, 100.0},
	}

	for _, tt := range tests {
		got := round1(tt.in)
		if got != tt.want {
			t.Errorf("round1(%v) = %v, want %v", tt.in, got, tt.want)
		}
	}
}

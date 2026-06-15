package ingest

import (
	"testing"
	"time"
)

func TestNewWSClient(t *testing.T) {
	cfg := WSConfig{
		Symbol:      "BTCUSDT",
		Market:      "futures",
		TickSize:    0.1,
		Compression: 25,
	}
	c := NewWSClient(cfg, []string{"1m", "5m", "15m"})
	if c == nil {
		t.Fatal("NewWSClient returned nil")
	}
	if c.cfg.Symbol != "BTCUSDT" {
		t.Errorf("Symbol = %q, want BTCUSDT", c.cfg.Symbol)
	}
	if len(c.aggs) != 3 {
		t.Errorf("aggs count = %d, want 3", len(c.aggs))
	}
}

func TestWSClientURL(t *testing.T) {
	cfg := WSConfig{Symbol: "BTCUSDT", Market: "futures"}
	c := NewWSClient(cfg, []string{"1m"})
	got := c.wsURL()
	want := "wss://fstream.binance.com/ws/btcusdt@trade"
	if got != want {
		t.Errorf("wsURL() = %q, want %q", got, want)
	}

	cfg2 := WSConfig{Symbol: "BTCUSDT", Market: "spot"}
	c2 := NewWSClient(cfg2, []string{"1m"})
	got2 := c2.wsURL()
	want2 := "wss://stream.binance.com:9443/ws/btcusdt@trade"
	if got2 != want2 {
		t.Errorf("wsURL() = %q, want %q", got2, want2)
	}
}

func TestWSClientBackoff(t *testing.T) {
	c := NewWSClient(WSConfig{Symbol: "BTCUSDT", Market: "futures"}, []string{"1m"})
	if c.backoff != time.Second {
		t.Errorf("initial backoff = %v, want 1s", c.backoff)
	}
	c.increaseBackoff()
	if c.backoff != 2*time.Second {
		t.Errorf("after increase: backoff = %v, want 2s", c.backoff)
	}
	for i := 0; i < 10; i++ {
		c.increaseBackoff()
	}
	if c.backoff != 30*time.Second {
		t.Errorf("capped backoff = %v, want 30s", c.backoff)
	}
}

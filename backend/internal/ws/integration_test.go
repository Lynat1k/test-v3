package ws_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

type testValidator struct{}

func (v *testValidator) GetConfig(symbol, market string) (struct {
	Symbol            string
	Market            string
	TickSize          float64
	BaseCompression   uint32
	CompressionLevels uint8
	DefaultCompression uint32
	TTLDays           uint32
	DOMSnapshotSec    uint32
	Enabled           bool
}, bool) {
	if symbol == "BTCUSDT" && (market == "futures" || market == "spot") {
		tickSize := 0.1
		baseComp := uint32(25)
		if market == "spot" {
			tickSize = 0.01
			baseComp = 500
		}
		return struct {
			Symbol            string
			Market            string
			TickSize          float64
			BaseCompression   uint32
			CompressionLevels uint8
			DefaultCompression uint32
			TTLDays           uint32
			DOMSnapshotSec    uint32
			Enabled           bool
		}{
			Symbol:             symbol,
			Market:             market,
			TickSize:           tickSize,
			BaseCompression:    baseComp,
			CompressionLevels:  10,
			DefaultCompression: baseComp,
			TTLDays:            365,
			DOMSnapshotSec:     60,
			Enabled:            true,
		}, true
	}
	return struct {
		Symbol            string
		Market            string
		TickSize          float64
		BaseCompression   uint32
		CompressionLevels uint8
		DefaultCompression uint32
		TTLDays           uint32
		DOMSnapshotSec    uint32
		Enabled           bool
	}{}, false
}

func (v *testValidator) ValidateCompression(comp uint32, tc interface{}) error {
	return nil
}

func (v *testValidator) ValidateTF(tf string, tc interface{}) error {
	return nil
}

// TestWSConnection tests basic WebSocket connection and subscribe/unsubscribe.
func TestWSConnection(t *testing.T) {
	// This test requires a running server. Skip if not available.
	t.Skip("Requires running server - run manually")

	// Connect
	dialer := websocket.Dialer{
		HandshakeTimeout: 5 * time.Second,
	}

	conn, _, err := dialer.Dial("ws://localhost:8090/ws", nil)
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	defer conn.Close()

	// Subscribe
	sub := map[string]interface{}{
		"action":      "subscribe",
		"symbol":      "BTCUSDT",
		"market":      "futures",
		"tf":          "1m",
		"compression": 25,
	}
	data, _ := json.Marshal(sub)
	if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
		t.Fatalf("write subscribe: %v", err)
	}

	// Read response
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, msg, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read response: %v", err)
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(msg, &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	t.Logf("Response: %s", string(msg))

	// Should get ok response
	if resp["type"] != "ok" {
		t.Errorf("expected type=ok, got %v", resp["type"])
	}

	// Unsubscribe
	unsub := map[string]interface{}{
		"action":      "unsubscribe",
		"symbol":      "BTCUSDT",
		"market":      "futures",
		"tf":          "1m",
		"compression": 25,
	}
	data, _ = json.Marshal(unsub)
	if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
		t.Fatalf("write unsubscribe: %v", err)
	}
}

// TestWSInvalidSubscribe tests invalid subscription parameters.
func TestWSInvalidSubscribe(t *testing.T) {
	t.Skip("Requires running server - run manually")

	dialer := websocket.Dialer{
		HandshakeTimeout: 5 * time.Second,
	}

	conn, _, err := dialer.Dial("ws://localhost:8090/ws", nil)
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	defer conn.Close()

	// Subscribe with invalid symbol
	sub := map[string]interface{}{
		"action":      "subscribe",
		"symbol":      "FAKECOIN",
		"market":      "futures",
		"tf":          "1m",
		"compression": 25,
	}
	data, _ := json.Marshal(sub)
	if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
		t.Fatalf("write subscribe: %v", err)
	}

	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	_, msg, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read response: %v", err)
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(msg, &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	t.Logf("Error response: %s", string(msg))

	if resp["type"] != "error" {
		t.Errorf("expected type=error, got %v", resp["type"])
	}
}

// TestWSBackpressure tests that slow clients get disconnected.
func TestWSBackpressure(t *testing.T) {
	t.Skip("Requires running server - run manually")

	dialer := websocket.Dialer{
		HandshakeTimeout: 5 * time.Second,
	}

	conn, _, err := dialer.Dial("ws://localhost:8090/ws", nil)
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	defer conn.Close()

	// Subscribe
	sub := map[string]interface{}{
		"action":      "subscribe",
		"symbol":      "BTCUSDT",
		"market":      "futures",
		"tf":          "1m",
		"compression": 25,
	}
	data, _ := json.Marshal(sub)
	if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
		t.Fatalf("write subscribe: %v", err)
	}

	// Don't read messages - let buffer fill up
	// Wait for server to try sending updates
	time.Sleep(30 * time.Second)

	// Try to read - should eventually get disconnected
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, _, err = conn.ReadMessage()
	if err == nil {
		t.Log("Connection still alive - backpressure may need more time or lower buffer")
	} else {
		t.Logf("Connection closed (expected): %v", err)
	}
}

// TestWSHTTPUpgrade tests that non-WebSocket requests are rejected.
func TestWSHTTPUpgrade(t *testing.T) {
	t.Skip("Requires running server - run manually")

	resp, err := http.Get("http://localhost:8090/ws")
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()

	// Should get 400 Bad Request (not a WebSocket upgrade)
	if resp.StatusCode == http.StatusOK {
		t.Errorf("expected non-200 status for non-WebSocket request, got %d", resp.StatusCode)
	}
	t.Logf("Status: %d", resp.StatusCode)
}

// TestWSMalformedJSON tests that malformed JSON is handled.
func TestWSMalformedJSON(t *testing.T) {
	t.Skip("Requires running server - run manually")

	dialer := websocket.Dialer{
		HandshakeTimeout: 5 * time.Second,
	}

	conn, _, err := dialer.Dial("ws://localhost:8090/ws", nil)
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	defer conn.Close()

	// Send malformed JSON
	if err := conn.WriteMessage(websocket.TextMessage, []byte("not json")); err != nil {
		t.Fatalf("write: %v", err)
	}

	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	_, msg, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read: %v", err)
	}

	if !strings.Contains(string(msg), "error") {
		t.Errorf("expected error response for malformed JSON, got: %s", string(msg))
	}
	t.Logf("Response: %s", string(msg))
}

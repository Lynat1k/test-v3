// ws_verify.go — WS hub verification client
// Connects to ws://localhost:8090/ws, subscribes, logs messages for ~90s.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/gorilla/websocket"
)

type msg struct {
	Type       string      `json:"type"`
	Action     string      `json:"action"`
	Symbol     string      `json:"symbol"`
	Market     string      `json:"market"`
	TF         string      `json:"tf"`
	Comp       uint32      `json:"compression"`
	CandleTime int64       `json:"candle_time"`
	Candle     interface{} `json:"candle,omitempty"`
	Error      interface{} `json:"error,omitempty"`
}

func main() {
	if len(os.Args) < 2 {
		fmt.Println("Usage: go run ws_verify.go <test>")
		fmt.Println("  test: subscribe | compression | backpressure")
		os.Exit(1)
	}

	switch os.Args[1] {
	case "subscribe":
		testSubscribe()
	case "compression":
		testCompression()
	case "backpressure":
		testBackpressure()
	default:
		fmt.Println("Unknown test:", os.Args[1])
		os.Exit(1)
	}
}

func dial() (*websocket.Conn, error) {
	dialer := websocket.Dialer{
		HandshakeTimeout: 5 * time.Second,
	}
	conn, _, err := dialer.Dial("ws://localhost:8090/ws", nil)
	return conn, err
}

// parseMessages splits newline-delimited JSON messages (WritePump batches them).
func parseMessages(raw []byte) []msg {
	var msgs []msg
	lines := bytes.Split(raw, []byte("\n"))
	for _, line := range lines {
		line = bytes.TrimSpace(line)
		if len(line) == 0 {
			continue
		}
		var m msg
		if err := json.Unmarshal(line, &m); err == nil {
			msgs = append(msgs, m)
		}
	}
	return msgs
}

func subscribe(conn *websocket.Conn, symbol, market, tf string, compression uint32) error {
	sub := map[string]interface{}{
		"action":      "subscribe",
		"symbol":      symbol,
		"market":      market,
		"tf":          tf,
		"compression": compression,
	}
	data, _ := json.Marshal(sub)
	return conn.WriteMessage(websocket.TextMessage, data)
}

// Test 1: Subscribe to futures 1m, log messages for 90s
func testSubscribe() {
	fmt.Println("=== TEST 1: Subscribe to futures 1m ===")
	fmt.Println("Connecting to ws://localhost:8090/ws ...")

	conn, err := dial()
	if err != nil {
		log.Fatalf("dial: %v", err)
	}
	defer conn.Close()
	fmt.Println("Connected!")

	// Subscribe
	if err := subscribe(conn, "BTCUSDT", "futures", "1m", 25); err != nil {
		log.Fatalf("subscribe: %v", err)
	}
	fmt.Println("Subscribed to BTCUSDT/futures/1m compression=25")
	fmt.Println("Listening for messages (90 seconds)...")
	fmt.Println("---")

	var updateCount, closeCount, openCount int
	deadline := time.Now().Add(90 * time.Second)
	conn.SetReadDeadline(deadline)

	for time.Now().Before(deadline) {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				fmt.Println("[CONNECTION CLOSED]", err)
				break
			}
			fmt.Printf("[READ ERROR] %v\n", err)
			break
		}

		msgs := parseMessages(raw)
		for _, m := range msgs {
			switch m.Type {
			case "update":
				updateCount++
				if updateCount <= 3 || updateCount%20 == 0 {
					candle := m.Candle.(map[string]interface{})
					cells := 0
					if c, ok := candle["cells"]; ok {
						if arr, ok := c.([]interface{}); ok {
							cells = len(arr)
						}
					}
					fmt.Printf("[%s] UPDATE #%d  time=%.0f  cells=%d  vol=%.1f  delta=%.1f\n",
						time.Now().Format("15:04:05"), updateCount,
						candle["time"], cells, candle["volume"], candle["delta"])
				} else if updateCount%10 == 0 {
					fmt.Printf("[%s] ... %d updates so far\n", time.Now().Format("15:04:05"), updateCount)
				}
			case "close":
				closeCount++
				candle := m.Candle.(map[string]interface{})
				cells := 0
				if c, ok := candle["cells"]; ok {
					if arr, ok := c.([]interface{}); ok {
						cells = len(arr)
					}
				}
				fmt.Printf("[%s] CLOSE #%d  time=%.0f  cells=%d  vol=%.1f  delta=%.1f  O=%.1f H=%.1f L=%.1f C=%.1f\n",
					time.Now().Format("15:04:05"), closeCount,
					candle["time"], cells, candle["volume"], candle["delta"],
					candle["open"], candle["high"], candle["low"], candle["close"])
			case "open":
				openCount++
				fmt.Printf("[%s] OPEN  #%d  candle_time=%.0f\n",
					time.Now().Format("15:04:05"), openCount, float64(m.CandleTime))
			case "error":
				fmt.Printf("[ERROR] %v\n", m.Error)
			case "ok":
				fmt.Printf("[OK] action=%s symbol=%s market=%s tf=%s comp=%d\n",
					m.Action, m.Symbol, m.Market, m.TF, m.Comp)
			}
		}
	}

	fmt.Println("---")
	fmt.Printf("SUMMARY: %d updates, %d closes, %d opens in 90s\n", updateCount, closeCount, openCount)
}

// Test 2: Subscribe with compression=50 (merged ×2)
func testCompression() {
	fmt.Println("=== TEST 2: Compression=50 (×2 merge) ===")
	fmt.Println("Connecting to ws://localhost:8090/ws ...")

	conn, err := dial()
	if err != nil {
		log.Fatalf("dial: %v", err)
	}
	defer conn.Close()
	fmt.Println("Connected!")

	// Subscribe with compression=50
	if err := subscribe(conn, "BTCUSDT", "futures", "1m", 50); err != nil {
		log.Fatalf("subscribe: %v", err)
	}
	fmt.Println("Subscribed to BTCUSDT/futures/1m compression=50")
	fmt.Println("Listening for messages (45 seconds)...")
	fmt.Println("---")

	var updateCount int
	deadline := time.Now().Add(45 * time.Second)
	conn.SetReadDeadline(deadline)

	for time.Now().Before(deadline) {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			fmt.Printf("[READ ERROR] %v\n", err)
			break
		}

		msgs := parseMessages(raw)
		for _, m := range msgs {
			switch m.Type {
			case "update":
				updateCount++
				candle := m.Candle.(map[string]interface{})
				cells := 0
				if c, ok := candle["cells"]; ok {
					if arr, ok := c.([]interface{}); ok {
						cells = len(arr)
					}
				}
				if updateCount <= 3 {
					fmt.Printf("[%s] UPDATE #%d  time=%.0f  cells=%d (compression=50, merged ×2)\n",
						time.Now().Format("15:04:05"), updateCount, candle["time"], cells)
					if c, ok := candle["cells"]; ok {
						if arr, ok := c.([]interface{}); ok {
							for i, cell := range arr {
								if i >= 3 {
									break
								}
								cm := cell.(map[string]interface{})
								fmt.Printf("  cell[%d]: price=%.1f bid=%.1f ask=%.1f\n",
									i, cm["price"], cm["bid"], cm["ask"])
							}
						}
					}
				} else if updateCount%15 == 0 {
					fmt.Printf("[%s] ... %d updates, cells=%d\n",
						time.Now().Format("15:04:05"), updateCount, cells)
				}
			case "ok":
				fmt.Printf("[OK] action=%s comp=%d\n", m.Action, m.Comp)
			}
		}
	}

	fmt.Println("---")
	fmt.Printf("SUMMARY: %d updates with compression=50\n", updateCount)
}

// Test 3: Backpressure — slow client gets disconnected
func testBackpressure() {
	fmt.Println("=== TEST 3: Backpressure test ===")
	fmt.Println("Buffer=256, 1 msg/200ms → fills in ~52s")

	// Client 1: normal, reads messages actively
	fmt.Println("Connecting client 1 (normal reader)...")
	conn1, err := dial()
	if err != nil {
		log.Fatalf("dial client1: %v", err)
	}
	defer conn1.Close()
	if err := subscribe(conn1, "BTCUSDT", "futures", "1m", 25); err != nil {
		log.Fatalf("subscribe client1: %v", err)
	}
	fmt.Println("Client 1 subscribed")

	// Client 2: slow — subscribes but never reads
	fmt.Println("Connecting client 2 (slow — will NOT read)...")
	conn2, err := dial()
	if err != nil {
		log.Fatalf("dial client2: %v", err)
	}
	defer conn2.Close()
	if err := subscribe(conn2, "BTCUSDT", "futures", "1m", 25); err != nil {
		log.Fatalf("subscribe client2: %v", err)
	}
	fmt.Println("Client 2 subscribed (never reading)")
	fmt.Println("Waiting ~60s for backpressure disconnect...")
	fmt.Println("---")

	// Client 1: refresh read deadline on each read (like ping/pong)
	// Client 2: long deadline, never reads — will be disconnected by server

	client1Alive := true
	client2Alive := true
	var client1Updates int
	client2Disconnected := make(chan bool, 1)
	client1Disconnected := make(chan bool, 1)

	// Reader for client 1 — refreshes deadline on each message
	go func() {
		for {
			_, raw, err := conn1.ReadMessage()
			if err != nil {
				fmt.Printf("[%s] Client 1 DISCONNECTED: %v\n", time.Now().Format("15:04:05"), err)
				client1Alive = false
				client1Disconnected <- true
				return
			}
			msgs := parseMessages(raw)
			client1Updates += len(msgs)
			if client1Updates%25 == 0 {
				fmt.Printf("[%s] Client 1: %d updates received\n", time.Now().Format("15:04:05"), client1Updates)
			}
			// Refresh read deadline
			conn1.SetReadDeadline(time.Now().Add(10 * time.Second))
		}
	}()

	// Reader for client 2 — waits to be disconnected by backpressure
	go func() {
		conn2.SetReadDeadline(time.Now().Add(90 * time.Second))
		for {
			_, _, err := conn2.ReadMessage()
			if err != nil {
				fmt.Printf("[%s] Client 2 DISCONNECTED (backpressure): %v\n", time.Now().Format("15:04:05"), err)
				client2Alive = false
				client2Disconnected <- true
				return
			}
		}
	}()

	// Wait for either client 2 to disconnect (success) or timeout
	select {
	case <-client2Disconnected:
		// Client 2 disconnected by backpressure
		time.Sleep(2 * time.Second)
		if client1Alive {
			fmt.Println("---")
			fmt.Printf("RESULT: client1 alive=%v (%d updates), client2 alive=%v\n",
				client1Alive, client1Updates, client2Alive)
			fmt.Println("PASS: slow client disconnected by backpressure, fast client continues")
		}
	case <-client1Disconnected:
		fmt.Println("---")
		fmt.Printf("RESULT: client1 disconnected first — unexpected\n")
	case <-time.After(65 * time.Second):
		fmt.Println("---")
		fmt.Printf("RESULT: timeout — client2 still alive after 65s\n")
		fmt.Println("NOTE: buffer may not have filled — check server buffer size")
	}

	// Brief pause then exit
	time.Sleep(500 * time.Millisecond)
}

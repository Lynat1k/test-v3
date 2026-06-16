package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/gorilla/websocket"
)

func main() {
	url := "ws://127.0.0.1:8090/ws"
	if len(os.Args) > 1 {
		url = os.Args[1]
	}

	log.Printf("[wsprobe] connecting to %s", url)

	dialer := websocket.Dialer{
		HandshakeTimeout: 5 * time.Second,
	}

	conn, _, err := dialer.Dial(url, nil)
	if err != nil {
		log.Fatalf("[wsprobe] dial failed: %v", err)
	}
	defer conn.Close()
	log.Printf("[wsprobe] CONNECTED ok, remote=%s", conn.RemoteAddr())

	sub := map[string]interface{}{
		"action":      "subscribe",
		"symbol":      "BTCUSDT",
		"market":      "futures",
		"tf":          "1m",
		"compression": 125,
	}
	data, _ := json.Marshal(sub)
	if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
		log.Fatalf("[wsprobe] subscribe write failed: %v", err)
	}
	log.Printf("[wsprobe] SUBSCRIBED: %s", string(data))

	conn.SetReadDeadline(time.Time{})

	for {
		msgType, msg, err := conn.ReadMessage()
		if err != nil {
			log.Fatalf("[wsprobe] ReadMessage error: %v", err)
		}
		ts := time.Now().Format("15:04:05.000")
		if msgType == websocket.TextMessage {
			var pretty map[string]interface{}
			if json.Unmarshal(msg, &pretty) == nil {
				b, _ := json.Marshal(pretty)
				fmt.Printf("[%s] ↓ TEXT (%d bytes): %s\n", ts, len(msg), string(b))
			} else {
				fmt.Printf("[%s] ↓ TEXT (%d bytes): %s\n", ts, len(msg), string(msg))
			}
		} else {
			fmt.Printf("[%s] ↓ TYPE=%d (%d bytes)\n", ts, msgType, len(msg))
		}
	}
}

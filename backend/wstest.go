package main

import (
"log"
"github.com/gorilla/websocket"
)

func main() {
c, _, err := websocket.DefaultDialer.Dial("ws://127.0.0.1:8090/ws", nil)
if err != nil {
log.Fatal("dial:", err)
}
defer c.Close()
c.WriteMessage(websocket.TextMessage, []byte(`{"action":"subscribe","symbol":"BTCUSDT","market":"futures","tf":"1m","compression":125}`))
log.Println("subscribed, waiting for messages...")
for {
_, msg, err := c.ReadMessage()
if err != nil {
log.Println("read error:", err)
return
}
log.Printf("GOT: %.100s", msg)
}
}

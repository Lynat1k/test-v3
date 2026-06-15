package ws

import (
	"encoding/json"
	"log"
	"net"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"procluster-backend/internal/aggregate"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 4096
	maxSubsPerClient = 20
)

// Client represents a single WebSocket connection.
type Client struct {
	hub  *Hub
	conn *websocket.Conn
	send chan []byte

	mu     sync.Mutex
	subKeys map[string]bool
	closed bool
}

// NewClient creates a new Client.
func NewClient(hub *Hub, conn *websocket.Conn) *Client {
	return &Client{
		hub:     hub,
		conn:    conn,
		send:    make(chan []byte, hub.writeBufSize),
		subKeys: make(map[string]bool),
	}
}

// RemoteAddr returns the remote network address.
func (c *Client) RemoteAddr() net.Addr {
	return c.conn.RemoteAddr()
}

// ReadPump pumps messages from the WebSocket connection to the hub.
func (c *Client) ReadPump() {
	defer func() {
		c.hub.Unregister(c)
		c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, msg, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("[WS] read error from %s: %v", c.RemoteAddr(), err)
			}
			return
		}
		c.handleMessage(msg)
	}
}

// WritePump pumps messages from the hub to the WebSocket connection.
func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case msg, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// Close closes the client connection.
func (c *Client) Close() {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return
	}
	c.closed = true
	c.mu.Unlock()

	c.conn.Close()
}

// handleMessage processes incoming JSON messages from the client.
func (c *Client) handleMessage(raw []byte) {
	var msg ClientMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		c.sendError("INVALID_JSON", "invalid message format")
		return
	}

	switch msg.Action {
	case "subscribe":
		c.handleSubscribe(msg)
	case "unsubscribe":
		c.handleUnsubscribe(msg)
	default:
		c.sendError("UNKNOWN_ACTION", "unknown action: "+msg.Action)
	}
}

func (c *Client) handleSubscribe(msg ClientMessage) {
	if msg.Symbol == "" || msg.Market == "" || msg.TF == "" {
		c.sendError("INVALID_PARAMS", "symbol, market, tf are required")
		return
	}
	if err := c.hub.Subscribe(c, msg.Market, msg.Symbol, msg.TF, msg.Comp); err != nil {
		ve, ok := err.(interface{ Error() string })
		if !ok {
			c.sendError("ERROR", err.Error())
			return
		}
		// Try to extract code from validateError
		type codeErr interface{ Code() string }
		if ce, ok := err.(codeErr); ok {
			c.sendError(ce.Code(), ve.Error())
			return
		}
		c.sendError("ERROR", ve.Error())
		return
	}
	c.sendOK("subscribed", msg)
}

func (c *Client) handleUnsubscribe(msg ClientMessage) {
	c.hub.Unsubscribe(c, msg.Market, msg.Symbol, msg.TF, msg.Comp)
	c.sendOK("unsubscribed", msg)
}

func (c *Client) sendError(code, message string) {
	resp := SubMessage{
		Type: "error",
		Error: &SubError{
			Code:    code,
			Message: message,
		},
	}
	data, _ := json.Marshal(resp)
	select {
	case c.send <- data:
	default:
	}
}

func (c *Client) sendOK(action string, msg ClientMessage) {
	resp := SubMessage{
		Type:   "ok",
		Action: action,
		Symbol: msg.Symbol,
		Market: msg.Market,
		TF:     msg.TF,
		Comp:   msg.Comp,
	}
	data, _ := json.Marshal(resp)
	select {
	case c.send <- data:
	default:
	}
}

// ClientMessage is the JSON structure for client -> server messages.
type ClientMessage struct {
	Action string `json:"action"`
	Symbol string `json:"symbol"`
	Market string `json:"market"`
	TF     string `json:"tf"`
	Comp   uint32 `json:"compression"`
}

// SubMessage is the JSON structure for server -> client messages.
type SubMessage struct {
	Type       string                  `json:"type"`
	Action     string                  `json:"action,omitempty"`
	Symbol     string                  `json:"symbol,omitempty"`
	Market     string                  `json:"market,omitempty"`
	TF         string                  `json:"tf,omitempty"`
	Comp       uint32                  `json:"compression,omitempty"`
	Candle     *aggregate.ClusterCandle `json:"candle,omitempty"`
	CandleTime int64                   `json:"candle_time,omitempty"`
	Error      *SubError               `json:"error,omitempty"`
}

// SubError represents an error message.
type SubError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *SubError) Error() string {
	return e.Message
}

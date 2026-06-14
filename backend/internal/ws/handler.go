package ws

import (
	"log"
	"net"
	"net/http"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true
		}
		host := extractHost(origin)
		return allowedWSHosts[host]
	},
}

var allowedWSHosts = map[string]bool{
	"chart.procluster.online":  true,
	"procluster.online":        true,
	"www.chart.procluster.online": true,
	"www.procluster.online":    true,
	"localhost":                true,
	"127.0.0.1":                true,
}

// Handler serves the WebSocket endpoint.
type Handler struct {
	hub *Hub

	mu        sync.Mutex
	connsByIP map[string]int
	maxPerIP  int
}

// NewHandler creates a new WebSocket handler.
func NewHandler(hub *Hub, maxConnsPerIP int) *Handler {
	if maxConnsPerIP == 0 {
		maxConnsPerIP = 10
	}
	return &Handler{
		hub:       hub,
		connsByIP: make(map[string]int),
		maxPerIP:  maxConnsPerIP,
	}
}

// ServeHTTP handles WebSocket upgrade requests at /ws.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ip := extractIP(r)
	if !h.checkIPLimit(ip) {
		http.Error(w, "too many connections from this IP", http.StatusTooManyRequests)
		return
	}
	defer h.releaseIP(ip)

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[WS] upgrade error: %v", err)
		return
	}

	client := NewClient(h.hub, conn)
	h.hub.Register(client)

	go client.WritePump()
	go client.ReadPump()
}

func (h *Handler) checkIPLimit(ip string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.connsByIP[ip] >= h.maxPerIP {
		return false
	}
	h.connsByIP[ip]++
	return true
}

func (h *Handler) releaseIP(ip string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.connsByIP[ip]--
	if h.connsByIP[ip] <= 0 {
		delete(h.connsByIP, ip)
	}
}

func extractIP(r *http.Request) string {
	forwarded := r.Header.Get("X-Forwarded-For")
	if forwarded != "" {
		parts := strings.Split(forwarded, ",")
		return strings.TrimSpace(parts[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func extractHost(origin string) string {
	s := strings.TrimPrefix(origin, "https://")
	s = strings.TrimPrefix(s, "http://")
	s = strings.TrimSuffix(s, "/")
	if idx := strings.Index(s, ":"); idx > 0 {
		s = s[:idx]
	}
	return s
}

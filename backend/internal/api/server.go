package api

import (
	"log"
	"net/http"
	"strings"

	"procluster-backend/internal/aggregate"
	"procluster-backend/internal/cache"
	"procluster-backend/internal/store"
)

var allowedOrigins = map[string]bool{
	"procluster.online":        true,
	"chart.procluster.online":  true,
	"www.procluster.online":    true,
	"www.chart.procluster.online": true,
}

type Server struct {
	ch        *store.ClickHouse
	rdb       *cache.RedisCache
	validator *Validator
	domMgr    *DOMManager
	fgCache   *FearGreedCache
}

func NewServer(ch *store.ClickHouse, rdb *cache.RedisCache, configs []aggregate.TickerConfig) *Server {
	return &Server{
		ch:        ch,
		rdb:       rdb,
		validator: NewValidator(configs),
		domMgr:    NewDOMManager(),
		fgCache:   NewFearGreedCache(rdb.GetClient()),
	}
}

func (s *Server) SetupRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/candles", s.corsMiddleware(s.handleCandles))
	mux.HandleFunc("/api/dom", s.corsMiddleware(s.handleDOM))
	mux.HandleFunc("/api/fear-greed", s.corsMiddleware(s.handleFearGreed))
	mux.HandleFunc("/api/tickers", s.corsMiddleware(s.handleTickers))
}

func (s *Server) corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			host := extractHost(origin)
			if allowedOrigins[host] {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			}
		}

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next(w, r)
	}
}

// authMiddleware sets temporary guest role. Will be replaced in phase 7.
func authMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Header.Set("X-User-Role", "guest")
		next(w, r)
	}
}

// rateLimitMiddleware is a stub for phase 14.
func rateLimitMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return authMiddleware(next)
}

func extractHost(origin string) string {
	// "https://chart.procluster.online" → "chart.procluster.online"
	s := strings.TrimPrefix(origin, "https://")
	s = strings.TrimPrefix(s, "http://")
	s = strings.TrimSuffix(s, "/")
	// Remove port if any
	if idx := strings.Index(s, ":"); idx > 0 {
		s = s[:idx]
	}
	return s
}

func jsonError(w http.ResponseWriter, status int, code, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	resp := errResponse(code, msg)
	w.Write(mustJSON(resp))
}

func logReq(r *http.Request) {
	log.Printf("[API] %s %s", r.Method, r.URL.String())
}

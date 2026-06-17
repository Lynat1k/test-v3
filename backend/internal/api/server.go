package api

import (
	"log"
	"net/http"
	"os"

	"procluster-backend/internal/aggregate"
	"procluster-backend/internal/cache"
	"procluster-backend/internal/store"
)

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

func (s *Server) CorsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && IsOriginAllowed(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-User-Role")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
		}

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next(w, r)
	}
}

func (s *Server) corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return s.CorsMiddleware(next)
}

// RequireAdmin checks X-User-Role == "admin". Bypasses with ADMIN_DEV_BYPASS=true.
func (s *Server) RequireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if os.Getenv("ADMIN_DEV_BYPASS") == "true" {
			log.Printf("[ADMIN] DEV BYPASS active for %s %s", r.Method, r.URL.Path)
			next(w, r)
			return
		}
		role := r.Header.Get("X-User-Role")
		if role != "admin" {
			jsonError(w, 403, "FORBIDDEN", "admin role required")
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

func jsonError(w http.ResponseWriter, status int, code, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	resp := errResponse(code, msg)
	w.Write(mustJSON(resp))
}

func logReq(r *http.Request) {
	log.Printf("[API] %s %s", r.Method, r.URL.String())
}

func (s *Server) GetConfig(symbol, market string) (aggregate.TickerConfig, bool) {
	return s.validator.GetConfig(symbol, market)
}

func (s *Server) ValidateCompression(comp uint32, tc aggregate.TickerConfig) error {
	return s.validator.ValidateCompression(comp, tc)
}

func (s *Server) ValidateTF(tf string, tc aggregate.TickerConfig) error {
	return s.validator.ValidateTF(tf, tc)
}

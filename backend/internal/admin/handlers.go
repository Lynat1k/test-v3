package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/mem"

	"procluster-backend/internal/aggregate"
	"procluster-backend/internal/cache"
	"procluster-backend/internal/history"
	"procluster-backend/internal/store"
)

type AdminHandler struct {
	ch       *store.ClickHouse
	rdb      *cache.RedisCache
	configs  []aggregate.TickerConfig
	hub      HubClient
	started  time.Time
	logBuf   *RingBuffer
	mu       sync.RWMutex
}

type HubClient interface {
	ClientCount() int
}

type historyJob struct {
	ID     string
	Status string // "running", "done", "error"
	Error  string
}

type progressEvent struct {
	Label   string `json:"label"`
	Current int    `json:"current"`
	Total   int    `json:"total"`
	Detail  string `json:"detail"`
}

var (
	jobs   = make(map[string]*historyJob)
	jobsMu sync.Mutex
)

func NewAdminHandler(ch *store.ClickHouse, rdb *cache.RedisCache, configs []aggregate.TickerConfig, hub HubClient) *AdminHandler {
	return &AdminHandler{
		ch:      ch,
		rdb:     rdb,
		configs: configs,
		hub:     hub,
		started: time.Now(),
		logBuf:  NewRingBuffer(500),
	}
}

func (h *AdminHandler) RegisterRoutes(mux *http.ServeMux, cors func(http.HandlerFunc) http.HandlerFunc, adminAuth func(http.HandlerFunc) http.HandlerFunc) {
	mux.HandleFunc("/api/admin/history/load", cors(adminAuth(h.handleHistoryLoad)))
	mux.HandleFunc("/api/admin/history/progress", cors(adminAuth(h.handleHistoryProgress)))
	mux.HandleFunc("/api/admin/metrics", cors(adminAuth(h.handleMetrics)))
	mux.HandleFunc("/api/admin/tickers", cors(adminAuth(h.handleTickers)))
	mux.HandleFunc("/api/admin/compression-defaults", cors(adminAuth(h.handleCompressionDefaults)))
	mux.HandleFunc("/api/admin/logs", cors(adminAuth(h.handleLogs)))
}

func (h *AdminHandler) handleHistoryLoad(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonError(w, 405, "METHOD_NOT_ALLOWED", "POST required")
		return
	}

	var req struct {
		Symbol string `json:"symbol"`
		Market string `json:"market"`
		From   string `json:"from"`
		To     string `json:"to"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, 400, "BAD_REQUEST", err.Error())
		return
	}

	if req.Symbol == "" || req.Market == "" || req.From == "" || req.To == "" {
		jsonError(w, 400, "BAD_REQUEST", "symbol, market, from, to required")
		return
	}

	from, err := time.Parse("2006-01-02", req.From)
	if err != nil {
		jsonError(w, 400, "BAD_REQUEST", "invalid from date")
		return
	}
	to, err := time.Parse("2006-01-02", req.To)
	if err != nil {
		jsonError(w, 400, "BAD_REQUEST", "invalid to date")
		return
	}

	symbol := strings.ToUpper(req.Symbol)
	market := strings.ToLower(req.Market)

	var tc *aggregate.TickerConfig
	for _, c := range h.configs {
		if c.Symbol == symbol && c.Market == market {
			tc = &c
			break
		}
	}
	if tc == nil {
		jsonError(w, 404, "NOT_FOUND", "ticker not found in config")
		return
	}

	tfByMarket := map[string][]string{
		"futures": {"1m", "5m", "15m", "30m", "1h", "4h"},
		"spot":    {"15m", "30m", "1h", "4h"},
	}
	tfs := tfByMarket[market]
	if len(tfs) == 0 {
		tfs = []string{"15m", "30m", "1h", "4h"}
	}

	jobID := fmt.Sprintf("job_%d", time.Now().UnixNano())
	jobsMu.Lock()
	jobs[jobID] = &historyJob{ID: jobID, Status: "running"}
	jobsMu.Unlock()

	cfg := history.HistoryConfig{
		Symbol:      symbol,
		Market:      market,
		From:        from,
		To:          to,
		TickSize:    tc.TickSize,
		Compression: tc.BaseCompression,
		Timeframes:  tfs,
	}

	go func() {
		p := history.NewPipeline(h.ch, func(label string, current, total int, detail string) {
			h.logBuf.Write(fmt.Sprintf("[History] %s %s %d/%d %s", symbol, label, current, total, detail))
		})
		err := p.Run(context.Background(), cfg)
		jobsMu.Lock()
		job := jobs[jobID]
		if err != nil {
			job.Status = "error"
			job.Error = err.Error()
		} else {
			job.Status = "done"
		}
		jobsMu.Unlock()
		h.logBuf.Write(fmt.Sprintf("[History] job %s finished: status=%s", jobID, job.Status))
	}()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"jobId": jobID})
}

func (h *AdminHandler) handleHistoryProgress(w http.ResponseWriter, r *http.Request) {
	jobID := r.URL.Query().Get("jobId")
	if jobID == "" {
		jsonError(w, 400, "BAD_REQUEST", "jobId required")
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		jsonError(w, 500, "INTERNAL", "SSE not supported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	ctx := r.Context()
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			jobsMu.Lock()
			job, exists := jobs[jobID]
			jobsMu.Unlock()

			if !exists {
				fmt.Fprintf(w, "event: error\ndata: {\"error\":\"job not found\"}\n\n")
				flusher.Flush()
				return
			}

			if job.Status == "done" {
				fmt.Fprintf(w, "event: done\ndata: {\"status\":\"done\"}\n\n")
				flusher.Flush()
				return
			}
			if job.Status == "error" {
				data, _ := json.Marshal(map[string]string{"error": job.Error})
				fmt.Fprintf(w, "event: error\ndata: %s\n\n", data)
				flusher.Flush()
				return
			}

			fmt.Fprintf(w, "event: progress\ndata: {\"status\":\"running\"}\n\n")
			flusher.Flush()
		}
	}
}

func (h *AdminHandler) handleMetrics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		jsonError(w, 405, "METHOD_NOT_ALLOWED", "GET required")
		return
	}

	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	cpuPct, _ := cpu.Percent(time.Second, false)
	cpuVal := 0.0
	if len(cpuPct) > 0 {
		cpuVal = cpuPct[0]
	}

	vm, _ := mem.VirtualMemory()
	sysRAM := 0.0
	if vm != nil {
		sysRAM = float64(vm.Used) / (1024 * 1024 * 1024)
	}

	chOK := "ok"
	if err := h.ch.Ping(); err != nil {
		chOK = "fail"
	}

	redisOK := "ok"
	if err := h.rdb.Ping(context.Background()); err != nil {
		redisOK = "fail"
	}

	wsClients := 0
	if h.hub != nil {
		wsClients = h.hub.ClientCount()
	}

	resp := map[string]interface{}{
		"uptime":        time.Since(h.started).Seconds(),
		"goroutines":    runtime.NumGoroutine(),
		"ram_alloc_mb":  float64(m.Alloc) / (1024 * 1024),
		"ram_sys_mb":    float64(m.Sys) / (1024 * 1024),
		"cpu_percent":   cpuVal,
		"system_ram_gb": sysRAM,
		"ws_clients":    wsClients,
		"clickhouse":    chOK,
		"redis":         redisOK,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (h *AdminHandler) handleTickers(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		h.handleGetTickers(w, r)
	case http.MethodPost:
		h.handlePostTicker(w, r)
	case http.MethodDelete:
		h.handleDeleteTicker(w, r)
	default:
		jsonError(w, 405, "METHOD_NOT_ALLOWED", "GET/POST/DELETE required")
	}
}

func (h *AdminHandler) handleGetTickers(w http.ResponseWriter, _ *http.Request) {
	ctx := context.Background()
	configs, err := h.ch.QueryTickerConfigsAll(ctx)
	if err != nil {
		jsonError(w, 500, "DB_ERROR", err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(configs)
}

func (h *AdminHandler) handlePostTicker(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Symbol            string   `json:"symbol"`
		Market            string   `json:"market"`
		TickSize          float64  `json:"tickSize"`
		BaseCompression   uint32   `json:"baseCompression"`
		CompressionLevels uint8    `json:"compressionLevels"`
		DefaultCompression uint32  `json:"defaultCompression"`
		TTLDays           uint32   `json:"ttlDays"`
		DOMSnapshotSec    uint32   `json:"domSnapshotSec"`
		Timeframes        []string `json:"timeframes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, 400, "BAD_REQUEST", err.Error())
		return
	}

	if req.Symbol == "" || req.Market == "" {
		jsonError(w, 400, "BAD_REQUEST", "symbol and market required")
		return
	}

	symbol := strings.ToUpper(req.Symbol)
	market := strings.ToLower(req.Market)

	if req.CompressionLevels == 0 {
		req.CompressionLevels = 10
	}
	if req.DefaultCompression == 0 {
		req.DefaultCompression = req.BaseCompression
	}
	if req.TTLDays == 0 {
		req.TTLDays = 365
	}
	if req.DOMSnapshotSec == 0 {
		req.DOMSnapshotSec = 60
	}

	ctx := context.Background()
	err := h.ch.UpsertTickerConfig(ctx, store.TickerConfigRow{
		Symbol:             symbol,
		Market:             market,
		TickSize:           req.TickSize,
		BaseCompression:    req.BaseCompression,
		CompressionLevels:  req.CompressionLevels,
		DefaultCompression: req.DefaultCompression,
		TTLDays:            req.TTLDays,
		DOMSnapshotSec:     req.DOMSnapshotSec,
		Enabled:            true,
	})
	if err != nil {
		jsonError(w, 500, "DB_ERROR", err.Error())
		return
	}

	h.mu.Lock()
	found := false
	for i, c := range h.configs {
		if c.Symbol == symbol && c.Market == market {
			h.configs[i] = aggregate.TickerConfig{
				Symbol: symbol, Market: market, TickSize: req.TickSize,
				BaseCompression: req.BaseCompression, CompressionLevels: req.CompressionLevels,
				DefaultCompression: req.DefaultCompression, TTLDays: req.TTLDays,
				DOMSnapshotSec: req.DOMSnapshotSec, Enabled: true,
			}
			found = true
			break
		}
	}
	if !found {
		h.configs = append(h.configs, aggregate.TickerConfig{
			Symbol: symbol, Market: market, TickSize: req.TickSize,
			BaseCompression: req.BaseCompression, CompressionLevels: req.CompressionLevels,
			DefaultCompression: req.DefaultCompression, TTLDays: req.TTLDays,
			DOMSnapshotSec: req.DOMSnapshotSec, Enabled: true,
		})
	}
	h.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (h *AdminHandler) handleDeleteTicker(w http.ResponseWriter, r *http.Request) {
	symbol := strings.ToUpper(r.URL.Query().Get("symbol"))
	market := strings.ToLower(r.URL.Query().Get("market"))
	if symbol == "" || market == "" {
		jsonError(w, 400, "BAD_REQUEST", "symbol and market required")
		return
	}

	ctx := context.Background()
	if err := h.ch.DeleteTickerConfig(ctx, symbol, market); err != nil {
		jsonError(w, 500, "DB_ERROR", err.Error())
		return
	}

	h.mu.Lock()
	for i, c := range h.configs {
		if c.Symbol == symbol && c.Market == market {
			h.configs = append(h.configs[:i], h.configs[i+1:]...)
			break
		}
	}
	h.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (h *AdminHandler) handleCompressionDefaults(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		ctx := context.Background()
		val, err := h.rdb.GetClient().Get(ctx, "admin:compression_defaults").Result()
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{})
			return
		}
		var defaults map[string]interface{}
		if err := json.Unmarshal([]byte(val), &defaults); err != nil {
			jsonError(w, 500, "PARSE_ERROR", err.Error())
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(defaults)

	case http.MethodPost:
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			jsonError(w, 400, "BAD_REQUEST", err.Error())
			return
		}
		data, err := json.Marshal(body)
		if err != nil {
			jsonError(w, 500, "MARSHAL_ERROR", err.Error())
			return
		}
		ctx := context.Background()
		if err := h.rdb.GetClient().Set(ctx, "admin:compression_defaults", data, 0).Err(); err != nil {
			jsonError(w, 500, "REDIS_ERROR", err.Error())
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})

	default:
		jsonError(w, 405, "METHOD_NOT_ALLOWED", "GET/POST required")
	}
}

func (h *AdminHandler) handleLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		jsonError(w, 405, "METHOD_NOT_ALLOWED", "GET required")
		return
	}
	lines := 200
	if v := r.URL.Query().Get("lines"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			lines = n
		}
	}

	logs := h.logBuf.LastN(lines)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"lines": logs})
}

func (h *AdminHandler) WriteLog(msg string) {
	h.logBuf.Write(msg)
}

func jsonError(w http.ResponseWriter, status int, code, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	resp := map[string]interface{}{
		"ok": false,
		"error": map[string]string{
			"code":    code,
			"message": msg,
		},
	}
	json.NewEncoder(w).Encode(resp)
}

func init() {
	log.SetOutput(os.Stderr)
}

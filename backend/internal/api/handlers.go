package api

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"procluster-backend/internal/aggregate"
)

func (s *Server) handleCandles(w http.ResponseWriter, r *http.Request) {
	logReq(r)
	if r.Method != http.MethodGet {
		jsonError(w, 405, "METHOD_NOT_ALLOWED", "only GET allowed")
		return
	}

	q := r.URL.Query()
	symbol := strings.ToUpper(q.Get("symbol"))
	market := strings.ToLower(q.Get("market"))
	tf := q.Get("tf")
	compressionStr := q.Get("compression")
	beforeStr := q.Get("before")
	limitStr := q.Get("limit")

	tc, err := s.validator.ValidateSymbolMarket(symbol, market)
	if err != nil {
		ve, ok := err.(validateError)
		if !ok {
			jsonError(w, 400, "INVALID_PARAMS", err.Error())
			return
		}
		jsonError(w, 400, ve.code, ve.message)
		return
	}

	if err := s.validator.ValidateTF(tf, tc); err != nil {
		ve := err.(validateError)
		jsonError(w, 400, ve.code, ve.message)
		return
	}

	var compression uint32
	if compressionStr != "" {
		comp, err := strconv.ParseUint(compressionStr, 10, 32)
		if err != nil {
			jsonError(w, 400, "INVALID_PARAMS", "invalid compression")
			return
		}
		compression = uint32(comp)
	} else {
		compression = tc.DefaultCompression
	}
	if compression == 0 {
		compression = tc.BaseCompression
	}
	if err := s.validator.ValidateCompression(compression, tc); err != nil {
		ve := err.(validateError)
		jsonError(w, 400, ve.code, ve.message)
		return
	}

	var beforeSec int64
	if beforeStr != "" {
		beforeSec, err = strconv.ParseInt(beforeStr, 10, 64)
		if err != nil {
			jsonError(w, 400, "INVALID_PARAMS", "invalid before (unix seconds)")
			return
		}
	}

	limit := 700
	if limitStr != "" {
		l, err := strconv.Atoi(limitStr)
		if err != nil || l < 1 || l > 2000 {
			jsonError(w, 400, "INVALID_PARAMS", "limit must be 1-2000")
			return
		}
		limit = l
	}

	role := r.Header.Get("X-User-Role")
	if role == "" {
		role = "guest"
	}
	historyDays := roleHistoryDays(role)

	var candles []aggregate.ClusterCandle
	var candlesFromCH bool

	if beforeSec == 0 && compression == tc.BaseCompression {
		cacheKey := aggregate.RedisCacheKey(market, symbol, tf)
		cached, err := s.rdb.GetLastCandles(r.Context(), cacheKey, int64(limit))
		if err == nil && len(cached) > 0 {
			candles = cached
		}
	}

	if len(candles) == 0 {
		candles, err = s.ch.QueryCandles(r.Context(), market, symbol, tf, beforeSec, limit)
		if err != nil {
			log.Printf("[API] candles error: %v", err)
			jsonError(w, 500, "CH_ERROR", "failed to query candles")
			return
		}
		candlesFromCH = true
	}
	_ = candlesFromCH

	historyLimited := false
	if historyDays > 0 && len(candles) > 0 {
		cutoffSec := timeNowUnixSec() - int64(historyDays)*86400
		filtered := candles[:0]
		for _, c := range candles {
			if c.Time >= cutoffSec {
				filtered = append(filtered, c)
			}
		}
		if len(filtered) < len(candles) {
			historyLimited = true
		}
		candles = filtered
	}
	_ = candlesFromCH

	if compression > tc.BaseCompression {
		groupSize := compression / tc.BaseCompression
		for i := range candles {
			merged := aggregate.MergeCells(candles[i].Cells, groupSize, tc.TickSize, tc.BaseCompression)
			candles[i].Cells = merged
			candles[i].Volume = 0
			candles[i].Delta = 0
			for _, cell := range merged {
				candles[i].Volume += cell.Bid + cell.Ask
				candles[i].Delta += cell.Ask - cell.Bid
			}
			candles[i].Volume = round1(candles[i].Volume)
			candles[i].Delta = round1(candles[i].Delta)
		}
	}

	result := make([]CandleJSON, 0, len(candles))
	for _, c := range candles {
		cj := CandleJSON{
			Time:   c.Time,
			Open:   c.Open,
			High:   c.High,
			Low:    c.Low,
			Close:  c.Close,
			Volume: c.Volume,
			Delta:  c.Delta,
			Cells:  make([]CellJSON, 0, len(c.Cells)),
		}

		maxVol := 0.0
		pocIdx := -1
		for idx, cell := range c.Cells {
			vol := cell.Bid + cell.Ask
			if vol > maxVol {
				maxVol = vol
				pocIdx = idx
			}
		}

		for idx, cell := range c.Cells {
			if cell.Price == 0 && cell.Bid == 0 && cell.Ask == 0 {
				continue
			}
			cjCell := CellJSON{
				Price:  cell.Price,
				Bid:    cell.Bid,
				Ask:    cell.Ask,
				Volume: round1(cell.Bid + cell.Ask),
				IsPoc:  idx == pocIdx,
			}

			if idx > 0 {
				prevBid := c.Cells[idx-1].Bid
				if cell.Ask > prevBid*3.0 && prevBid > 0 {
					cjCell.IsBuyImbalance = true
				}
			}
			if idx < len(c.Cells)-1 {
				nextAsk := c.Cells[idx+1].Ask
				if cell.Bid > nextAsk*3.0 && nextAsk > 0 {
					cjCell.IsSellImbalance = true
				}
			}

			cj.Cells = append(cj.Cells, cjCell)
		}

		result = append(result, cj)
	}

	jsonResponse(w, okResponse(CandlesData{
		Candles:        result,
		HistoryLimited: historyLimited,
	}))
}

func (s *Server) handleTickers(w http.ResponseWriter, r *http.Request) {
	logReq(r)
	if r.Method != http.MethodGet {
		jsonError(w, 405, "METHOD_NOT_ALLOWED", "only GET allowed")
		return
	}

	configs := s.validator.AllConfigs()

	tfsByMarket := map[string][]string{
		"futures": {"1m", "5m", "15m", "30m", "1h", "4h"},
		"spot":    {"15m", "30m", "1h", "4h"},
	}

	items := make([]TickerItem, 0, len(configs))
	for _, tc := range configs {
		items = append(items, TickerItem{
			Symbol:             tc.Symbol,
			Market:             tc.Market,
			TickSize:           tc.TickSize,
			BaseCompression:    tc.BaseCompression,
			CompressionLevels:  tc.CompressionLevels,
			DefaultCompression: tc.DefaultCompression,
			Timeframes:         tfsByMarket[tc.Market],
		})
	}

	jsonResponse(w, okResponse(items))
}

func jsonResponse(w http.ResponseWriter, resp APIResponse) {
	w.Header().Set("Content-Type", "application/json")
	data, err := json.Marshal(resp)
	if err != nil {
		w.WriteHeader(500)
		fmt.Fprintf(w, `{"ok":false,"error":{"code":"INTERNAL","message":"json marshal error"}}`)
		return
	}
	w.Write(data)
}

func mustJSON(v interface{}) []byte {
	data, _ := json.Marshal(v)
	return data
}

func round1(v float64) float64 {
	return math.Round(v*10) / 10
}

func roleHistoryDays(role string) int {
	switch role {
	case "guest":
		return 7
	case "free":
		return 180
	case "pro":
		return 365
	case "vip", "admin":
		return -1
	default:
		return 7
	}
}

func timeNowUnixSec() int64 {
	return time.Now().Unix()
}

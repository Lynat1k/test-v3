package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type DOMManager struct {
	mu      sync.RWMutex
	streams map[string]*domStream
}

type domStream struct {
	symbol    string
	market    string
	bids      []domLevel
	asks      []domLevel
	midPrice  float64
	updatedAt time.Time
	cancel    context.CancelFunc
}

type domLevel struct {
	price float64
	qty   float64
}

type binanceDepthResponse struct {
	LastUpdateId int64        `json:"lastUpdateId"`
	Bids         [][]string   `json:"bids"`
	Asks         [][]string   `json:"asks"`
}

func NewDOMManager() *DOMManager {
	return &DOMManager{
		streams: make(map[string]*domStream),
	}
}

func (dm *DOMManager) GetDOM(symbol, market string) (*DOMData, bool) {
	dm.mu.RLock()
	defer dm.mu.RUnlock()

	key := symbol + ":" + market
	stream, ok := dm.streams[key]
	if !ok {
		return nil, false
	}

	bids := make([]DOMLevel, len(stream.bids))
	for i, b := range stream.bids {
		bids[i] = DOMLevel{Price: b.price, Qty: round1(b.qty)}
	}
	asks := make([]DOMLevel, len(stream.asks))
	for i, a := range stream.asks {
		asks[i] = DOMLevel{Price: a.price, Qty: round1(a.qty)}
	}

	return &DOMData{
		Bids:     bids,
		Asks:     asks,
		MidPrice: math.Round(stream.midPrice*10) / 10,
		Updated:  stream.updatedAt.UnixMilli(),
	}, true
}

func (dm *DOMManager) StartStream(ctx context.Context, symbol, market string, binSize float64) {
	dm.mu.Lock()
	key := symbol + ":" + market
	if _, ok := dm.streams[key]; ok {
		dm.mu.Unlock()
		return
	}
	streamCtx, cancel := context.WithCancel(ctx)
	stream := &domStream{symbol: symbol, market: market, cancel: cancel}
	dm.streams[key] = stream
	dm.mu.Unlock()

	go dm.pollLoop(streamCtx, stream, binSize)
}

func (dm *DOMManager) StopAll() {
	dm.mu.Lock()
	defer dm.mu.Unlock()
	for _, stream := range dm.streams {
		stream.cancel()
	}
}

func (dm *DOMManager) pollLoop(ctx context.Context, stream *domStream, binSize float64) {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	dm.fetchAndUpdate(stream, binSize)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			dm.fetchAndUpdate(stream, binSize)
		}
	}
}

func (dm *DOMManager) fetchAndUpdate(stream *domStream, binSize float64) {
	depth, err := fetchBinanceDepth(stream.symbol, stream.market)
	if err != nil {
		log.Printf("[DOM] %s/%s fetch error: %v", stream.market, stream.symbol, err)
		return
	}

	aggBids, aggAsks, midPrice := aggregateDOM(depth, binSize)

	dm.mu.Lock()
	stream.bids = aggBids
	stream.asks = aggAsks
	stream.midPrice = midPrice
	stream.updatedAt = time.Now()
	dm.mu.Unlock()
}

func fetchBinanceDepth(symbol, market string) (*binanceDepthResponse, error) {
	var url string
	sym := strings.ToUpper(symbol)
	if market == "futures" {
		url = fmt.Sprintf("https://fapi.binance.com/fapi/v1/depth?symbol=%s&limit=1000", sym)
	} else {
		url = fmt.Sprintf("https://api.binance.com/api/v3/depth?symbol=%s&limit=1000", sym)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var depth binanceDepthResponse
	if err := json.NewDecoder(resp.Body).Decode(&depth); err != nil {
		return nil, err
	}

	return &depth, nil
}

func aggregateDOM(depth *binanceDepthResponse, binSize float64) (bids []domLevel, asks []domLevel, midPrice float64) {
	bidMap := make(map[float64]float64)
	askMap := make(map[float64]float64)

	for _, b := range depth.Bids {
		if len(b) < 2 {
			continue
		}
		price, err := strconv.ParseFloat(b[0], 64)
		if err != nil {
			continue
		}
		qty, err := strconv.ParseFloat(b[1], 64)
		if err != nil {
			continue
		}
		bin := math.Floor(price/binSize) * binSize
		bidMap[bin] += qty
	}

	for _, a := range depth.Asks {
		if len(a) < 2 {
			continue
		}
		price, err := strconv.ParseFloat(a[0], 64)
		if err != nil {
			continue
		}
		qty, err := strconv.ParseFloat(a[1], 64)
		if err != nil {
			continue
		}
		bin := math.Floor(price/binSize) * binSize
		askMap[bin] += qty
	}

	bestBid := 0.0
	bestAsk := 0.0
	for p := range bidMap {
		if p > bestBid {
			bestBid = p
		}
	}
	for p := range askMap {
		if bestAsk == 0 || p < bestAsk {
			bestAsk = p
		}
	}
	if bestBid > 0 && bestAsk > 0 {
		midPrice = (bestBid + bestAsk) / 2
	} else if bestBid > 0 {
		midPrice = bestBid
	} else {
		midPrice = bestAsk
	}

	margin := midPrice * 0.05

	bids = make([]domLevel, 0, len(bidMap))
	for price, qty := range bidMap {
		if midPrice > 0 && price >= midPrice-margin {
			bids = append(bids, domLevel{price: price, qty: qty})
		}
	}
	asks = make([]domLevel, 0, len(askMap))
	for price, qty := range askMap {
		if midPrice > 0 && price <= midPrice+margin {
			asks = append(asks, domLevel{price: price, qty: qty})
		}
	}

	sort.Slice(bids, func(i, j int) bool { return bids[i].price > bids[j].price })
	sort.Slice(asks, func(i, j int) bool { return asks[i].price < asks[j].price })

	return
}

func (s *Server) handleDOM(w http.ResponseWriter, r *http.Request) {
	logReq(r)
	if r.Method != http.MethodGet {
		jsonError(w, 405, "METHOD_NOT_ALLOWED", "only GET allowed")
		return
	}

	q := r.URL.Query()
	symbol := strings.ToUpper(q.Get("symbol"))
	market := strings.ToLower(q.Get("market"))

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

	binSize := float64(tc.BaseCompression) * tc.TickSize
	s.domMgr.StartStream(r.Context(), symbol, market, binSize)

	domData, ok := s.domMgr.GetDOM(symbol, market)
	if !ok {
		jsonError(w, 503, "DOM_LOADING", "order book is loading, retry in 1s")
		return
	}

	jsonResponse(w, okResponse(domData))
}

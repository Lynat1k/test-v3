package ingest

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strconv"
	"time"

	"procluster-backend/internal/aggregate"
	"procluster-backend/internal/proxy"
)

// TradeHandler is called for each sorted, deduplicated trade.
type TradeHandler func(trade aggregate.Trade)

// SortAndDedup sorts a batch of trades by tradeId and filters duplicates.
func SortAndDedup(trades []aggregate.Trade, seen map[int64]bool) []aggregate.Trade {
	sort.Slice(trades, func(i, j int) bool {
		return trades[i].TradeID < trades[j].TradeID
	})
	result := make([]aggregate.Trade, 0, len(trades))
	for _, t := range trades {
		if seen[t.TradeID] {
			continue
		}
		seen[t.TradeID] = true
		result = append(result, t)
	}
	return result
}

// ParseTradeMessage parses a Binance trade JSON message into a Trade.
// Uses map-based parsing to avoid Go's case-insensitive JSON field matching
// (e.g. "e" matching both "e" and "E" keys in Binance messages).
func ParseTradeMessage(data []byte) (aggregate.Trade, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return aggregate.Trade{}, fmt.Errorf("unmarshal raw: %w", err)
	}

	getString := func(key string) string {
		v, ok := raw[key]
		if !ok {
			return ""
		}
		var s string
		json.Unmarshal(v, &s)
		return s
	}

	getInt64 := func(key string) int64 {
		v, ok := raw[key]
		if !ok {
			return 0
		}
		var n int64
		json.Unmarshal(v, &n)
		return n
	}

	getBool := func(key string) bool {
		v, ok := raw[key]
		if !ok {
			return false
		}
		var b bool
		json.Unmarshal(v, &b)
		return b
	}

	price, err := strconv.ParseFloat(getString("p"), 64)
	if err != nil {
		return aggregate.Trade{}, fmt.Errorf("parse price: %w", err)
	}
	qty, err := strconv.ParseFloat(getString("q"), 64)
	if err != nil {
		return aggregate.Trade{}, fmt.Errorf("parse qty: %w", err)
	}
	return aggregate.Trade{
		TradeID:      getInt64("t"),
		Price:        price,
		Qty:          qty,
		TradeTimeMs:  getInt64("T"),
		IsBuyerMaker: getBool("m"),
	}, nil
}

// FetchHistoricalTrades fetches recent trades from Binance REST API.
// symbol: e.g. "BTCUSDT"
// market: "futures" or "spot"
// fromID: start tradeId (0 = latest)
// limit: max 1000
func FetchHistoricalTrades(ctx context.Context, symbol, market string, fromID int64, limit int) ([]aggregate.Trade, error) {
	var baseURL string
	if market == "futures" {
		baseURL = "https://fapi.binance.com"
	} else {
		baseURL = "https://api.binance.com"
	}

	endpoint := fmt.Sprintf("%s/api/v3/historicalTrades", baseURL)
	if market == "futures" {
		endpoint = fmt.Sprintf("%s/fapi/v1/historicalTrades", baseURL)
	}

	req, err := http.NewRequestWithContext(ctx, "GET", endpoint, nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	q.Set("symbol", symbol)
	q.Set("limit", strconv.Itoa(limit))
	if fromID > 0 {
		q.Set("fromId", strconv.FormatInt(fromID, 10))
	}
	req.URL.RawQuery = q.Encode()

	resp, err := proxy.HTTPClient().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var raw []struct {
		ID           int64  `json:"id"`
		Price        string `json:"price"`
		Qty          string `json:"qty"`
		Time         int64  `json:"time"`
		IsBuyerMaker bool   `json:"isBuyerMaker"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, err
	}

	trades := make([]aggregate.Trade, 0, len(raw))
	for _, r := range raw {
		price, _ := strconv.ParseFloat(r.Price, 64)
		qty, _ := strconv.ParseFloat(r.Qty, 64)
		trades = append(trades, aggregate.Trade{
			TradeID:      r.ID,
			Price:        price,
			Qty:          qty,
			TradeTimeMs:  r.Time,
			IsBuyerMaker: r.IsBuyerMaker,
		})
	}
	return trades, nil
}

// GapFiller detects tradeId gaps and fetches missing trades via REST.
type GapFiller struct {
	symbol string
	market string
}

// NewGapFiller creates a new gap filler.
func NewGapFiller(symbol, market string) *GapFiller {
	return &GapFiller{symbol: symbol, market: market}
}

// FillGap fetches trades in the range [start, end] from Binance REST.
func (g *GapFiller) FillGap(ctx context.Context, start, end int64) ([]aggregate.Trade, error) {
	log.Printf("filling gap: tradeId %d–%d", start, end)
	var all []aggregate.Trade
	current := start
	for current <= end {
		batch, err := FetchHistoricalTrades(ctx, g.symbol, g.market, current, 1000)
		if err != nil {
			return nil, err
		}
		if len(batch) == 0 {
			break
		}
		for _, t := range batch {
			if t.TradeID > end {
				return all, nil
			}
			all = append(all, t)
			current = t.TradeID + 1
		}
		time.Sleep(100 * time.Millisecond) // rate limit
	}
	return all, nil
}

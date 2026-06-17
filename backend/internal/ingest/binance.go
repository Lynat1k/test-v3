package ingest

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"sort"
	"strconv"
	"time"

	"procluster-backend/internal/aggregate"
	"procluster-backend/internal/proxy"
)

// ErrRateLimited is returned when Binance responds with HTTP 429/418 or code -1003.
var ErrRateLimited = errors.New("binance rate limited")

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

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != 200 {
		var errResp struct {
			Code int    `json:"code"`
			Msg  string `json:"msg"`
		}
		json.Unmarshal(body, &errResp)
		if resp.StatusCode == 429 || resp.StatusCode == 418 || errResp.Code == -1003 {
			log.Printf("WARN: binance %s %s rate limited: HTTP %d code=%d msg=%s", market, symbol, resp.StatusCode, errResp.Code, errResp.Msg)
			return nil, ErrRateLimited
		}
		return nil, fmt.Errorf("binance %s %s: HTTP %d code=%d msg=%s", market, symbol, resp.StatusCode, errResp.Code, errResp.Msg)
	}

	// Check if response is an error object (not an array)
	if len(body) > 0 && body[0] != '[' {
		var errResp struct {
			Code int    `json:"code"`
			Msg  string `json:"msg"`
		}
		if err := json.Unmarshal(body, &errResp); err == nil && errResp.Code != 0 {
			if errResp.Code == -1003 {
				log.Printf("WARN: binance %s %s rate limited: code=%d msg=%s", market, symbol, errResp.Code, errResp.Msg)
				return nil, ErrRateLimited
			}
			return nil, fmt.Errorf("binance error: code=%d msg=%s", errResp.Code, errResp.Msg)
		}
		return nil, fmt.Errorf("binance unexpected response: %s", string(body))
	}

	var raw []struct {
		ID           int64  `json:"id"`
		Price        string `json:"price"`
		Qty          string `json:"qty"`
		Time         int64  `json:"time"`
		IsBuyerMaker bool   `json:"isBuyerMaker"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("unmarshal trades: %w", err)
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
			if errors.Is(err, ErrRateLimited) {
				log.Printf("WARN: gap-fill rate limited, retrying in 2s (current=%d)", current)
				time.Sleep(2 * time.Second)
				// retry up to 3 times
				for retry := 0; retry < 3; retry++ {
					batch, err = FetchHistoricalTrades(ctx, g.symbol, g.market, current, 1000)
					if err == nil || !errors.Is(err, ErrRateLimited) {
						break
					}
					log.Printf("WARN: gap-fill rate limited retry %d/3", retry+1)
					time.Sleep(2 * time.Second)
				}
				if err != nil {
					log.Printf("WARN: gap-fill giving up after retries, returning partial result (%d trades)", len(all))
					return all, nil
				}
			} else {
				return nil, err
			}
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

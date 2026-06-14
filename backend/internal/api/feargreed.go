package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

const fearGreedURL = "https://api.alternative.me/fng/?limit=1"
const fearGreedCacheTTL = 24 * time.Hour
const fearGreedRedisKey = "cache:fear-greed"

type FearGreedCache struct {
	rdb *redis.Client
}

type fearGreedRaw struct {
	Data []struct {
		Value          string `json:"value"`
		Classification string `json:"value_classification"`
		Timestamp      string `json:"timestamp"`
	} `json:"data"`
}

type fearGreedStored struct {
	Value          int    `json:"v"`
	Classification string `json:"c"`
	Timestamp      int64  `json:"t"`
}

func NewFearGreedCache(rdb *redis.Client) *FearGreedCache {
	if rdb == nil {
		return nil
	}
	return &FearGreedCache{rdb: rdb}
}

func (fg *FearGreedCache) GetOrFetch(ctx context.Context) (*FearGreedData, error) {
	val, err := fg.rdb.Get(ctx, fearGreedRedisKey).Result()
	if err == nil {
		var stored fearGreedStored
		if json.Unmarshal([]byte(val), &stored) == nil {
			return &FearGreedData{
				Value:          stored.Value,
				Classification: stored.Classification,
				Timestamp:      stored.Timestamp,
			}, nil
		}
	}

	data, err := fetchFearGreedFromAPI()
	if err != nil {
		return nil, err
	}

	stored := fearGreedStored{
		Value:          data.Value,
		Classification: data.Classification,
		Timestamp:      data.Timestamp,
	}
	storedJSON, _ := json.Marshal(stored)
	fg.rdb.Set(ctx, fearGreedRedisKey, string(storedJSON), fearGreedCacheTTL)

	return data, nil
}

func fetchFearGreedFromAPI() (*FearGreedData, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", fearGreedURL, nil)
	if err != nil {
		return nil, err
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fear greed fetch: %w", err)
	}
	defer resp.Body.Close()

	var raw fearGreedRaw
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("fear greed decode: %w", err)
	}

	if len(raw.Data) == 0 {
		return nil, fmt.Errorf("fear greed: empty response")
	}

	val, err := strconv.Atoi(raw.Data[0].Value)
	if err != nil {
		return nil, fmt.Errorf("fear greed parse value: %w", err)
	}

	ts, _ := strconv.ParseInt(raw.Data[0].Timestamp, 10, 64)

	return &FearGreedData{
		Value:          val,
		Classification: raw.Data[0].Classification,
		Timestamp:      ts,
	}, nil
}

func (s *Server) handleFearGreed(w http.ResponseWriter, r *http.Request) {
	logReq(r)
	if r.Method != http.MethodGet {
		jsonError(w, 405, "METHOD_NOT_ALLOWED", "only GET allowed")
		return
	}

	if s.fgCache == nil {
		data, err := fetchFearGreedFromAPI()
		if err != nil {
			log.Printf("[FearGreed] fetch error: %v", err)
			jsonError(w, 502, "UPSTREAM_ERROR", "failed to fetch fear & greed index")
			return
		}
		jsonResponse(w, okResponse(data))
		return
	}

	data, err := s.fgCache.GetOrFetch(r.Context())
	if err != nil {
		log.Printf("[FearGreed] error: %v", err)
		jsonError(w, 502, "UPSTREAM_ERROR", "failed to fetch fear & greed index")
		return
	}

	jsonResponse(w, okResponse(data))
}

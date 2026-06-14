package cache

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"procluster-backend/internal/aggregate"
)

const maxLastCandles = 700

// RedisCache wraps Redis operations for aggregation, candle cache, and zip cache.
type RedisCache struct {
	rdb *redis.Client
}

// New creates a new RedisCache.
func New(addr string) *RedisCache {
	rdb := redis.NewClient(&redis.Options{Addr: addr})
	return &RedisCache{rdb: rdb}
}

// Ping checks Redis connectivity.
func (c *RedisCache) Ping(ctx context.Context) error {
	return c.rdb.Ping(ctx).Err()
}

// Close closes the Redis connection.
func (c *RedisCache) Close() error {
	return c.rdb.Close()
}

// GetClient returns the underlying Redis client for direct use.
func (c *RedisCache) GetClient() *redis.Client {
	return c.rdb
}

// --- Live aggregation (Hash) ---

// IncrCell increments bid/ask for a price bin in the live aggregation hash.
func (c *RedisCache) IncrCell(ctx context.Context, key string, priceLow float64, bidDelta, askDelta float64) error {
	field := strconv.FormatFloat(priceLow, 'f', 1, 64)

	// Read current value
	val, err := c.rdb.HGet(ctx, key, field).Result()
	var bid, ask float64
	if err == nil {
		parts := strings.Split(val, ",")
		if len(parts) == 2 {
			bid, _ = strconv.ParseFloat(parts[0], 64)
			ask, _ = strconv.ParseFloat(parts[1], 64)
		}
	}

	bid += bidDelta
	ask += askDelta
	newVal := fmt.Sprintf("%.1f,%.1f", bid, ask)
	return c.rdb.HSet(ctx, key, field, newVal).Err()
}

// GetAggCells reads all cells from a live aggregation hash and returns them as ClusterCells.
func (c *RedisCache) GetAggCells(ctx context.Context, key string) ([]aggregate.ClusterCell, error) {
	data, err := c.rdb.HGetAll(ctx, key).Result()
	if err != nil {
		return nil, err
	}

	cells := make([]aggregate.ClusterCell, 0, len(data))
	for field, val := range data {
		price, err := strconv.ParseFloat(field, 64)
		if err != nil {
			continue
		}
		parts := strings.Split(val, ",")
		if len(parts) != 2 {
			continue
		}
		bid, _ := strconv.ParseFloat(parts[0], 64)
		ask, _ := strconv.ParseFloat(parts[1], 64)
		cells = append(cells, aggregate.ClusterCell{Price: price, Bid: bid, Ask: ask})
	}
	return cells, nil
}

// DelAggKey deletes a live aggregation key.
func (c *RedisCache) DelAggKey(ctx context.Context, key string) error {
	return c.rdb.Del(ctx, key).Err()
}

// --- Last-700 candle cache (Sorted Set) ---

// cachedCandle is the JSON-serializable form stored in Redis.
type cachedCandle struct {
	Time  int64                  `json:"time"`
	Open  float64                `json:"open"`
	High  float64                `json:"high"`
	Low   float64                `json:"low"`
	Close float64                `json:"close"`
	Vol   float64                `json:"volume"`
	Delta float64                `json:"delta"`
	Cells []aggregate.ClusterCell `json:"cells"`
}

// SetLastCandle adds a candle to the last-700 sorted set and trims to maxLastCandles.
func (c *RedisCache) SetLastCandle(ctx context.Context, key string, candle aggregate.ClusterCandle) error {
	member := cachedCandle{
		Time:  candle.Time,
		Open:  candle.Open,
		High:  candle.High,
		Low:   candle.Low,
		Close: candle.Close,
		Vol:   candle.Volume,
		Delta: candle.Delta,
		Cells: candle.Cells,
	}
	data, err := json.Marshal(member)
	if err != nil {
		return err
	}

	pipe := c.rdb.Pipeline()
	pipe.ZAdd(ctx, key, redis.Z{Score: float64(candle.Time), Member: string(data)})
	pipe.ZRemRangeByRank(ctx, key, 0, -int64(maxLastCandles+1))
	_, err = pipe.Exec(ctx)
	return err
}

// GetLastCandles returns up to limit candles from the cache, most recent first.
func (c *RedisCache) GetLastCandles(ctx context.Context, key string, limit int64) ([]aggregate.ClusterCandle, error) {
	results, err := c.rdb.ZRevRangeByScoreWithScores(ctx, key, &redis.ZRangeBy{
		Min:    "-inf",
		Max:    "+inf",
		Count:  limit,
	}).Result()
	if err != nil {
		return nil, err
	}

	candles := make([]aggregate.ClusterCandle, 0, len(results))
	for _, z := range results {
		var cc cachedCandle
		if err := json.Unmarshal([]byte(z.Member.(string)), &cc); err != nil {
			continue
		}
		candles = append(candles, aggregate.ClusterCandle{
			Time:   cc.Time,
			Open:   cc.Open,
			High:   cc.High,
			Low:    cc.Low,
			Close:  cc.Close,
			Volume: cc.Vol,
			Delta:  cc.Delta,
			Cells:  cc.Cells,
		})
	}
	return candles, nil
}

// --- Higher compression cache (Sorted Set with TTL) ---

// SetZipCandles writes merged candles to the zip cache with a TTL.
func (c *RedisCache) SetZipCandles(ctx context.Context, key string, candles []aggregate.ClusterCandle) error {
	pipe := c.rdb.Pipeline()
	for _, candle := range candles {
		member := cachedCandle{
			Time:  candle.Time,
			Open:  candle.Open,
			High:  candle.High,
			Low:   candle.Low,
			Close: candle.Close,
			Vol:   candle.Volume,
			Delta: candle.Delta,
			Cells: candle.Cells,
		}
		data, err := json.Marshal(member)
		if err != nil {
			return err
		}
		pipe.ZAdd(ctx, key, redis.Z{Score: float64(candle.Time), Member: string(data)})
	}
	pipe.Expire(ctx, key, 5*time.Minute)
	_, err := pipe.Exec(ctx)
	return err
}

// GetZipCandles returns cached merged candles for a higher compression level.
func (c *RedisCache) GetZipCandles(ctx context.Context, key string, limit int64) ([]aggregate.ClusterCandle, error) {
	results, err := c.rdb.ZRevRangeByScoreWithScores(ctx, key, &redis.ZRangeBy{
		Min:    "-inf",
		Max:    "+inf",
		Count:  limit,
	}).Result()
	if err != nil {
		return nil, err
	}
	if len(results) == 0 {
		return nil, nil
	}

	candles := make([]aggregate.ClusterCandle, 0, len(results))
	for _, z := range results {
		var cc cachedCandle
		if err := json.Unmarshal([]byte(z.Member.(string)), &cc); err != nil {
			continue
		}
		candles = append(candles, aggregate.ClusterCandle{
			Time:   cc.Time,
			Open:   cc.Open,
			High:   cc.High,
			Low:    cc.Low,
			Close:  cc.Close,
			Volume: cc.Vol,
			Delta:  cc.Delta,
			Cells:  cc.Cells,
		})
	}
	return candles, nil
}

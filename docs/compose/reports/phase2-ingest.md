---
feature: phase2-ingest
status: delivered
specs:
plans:
  - docs/compose/plans/2026-06-14-phase2-ingest.md
branch: master
commits: 8c0e05b
---

# Phase 2: Binance WS Ingest + Redis Live-Aggregation + ClickHouse Store

## What Was Built

Realtime data ingest pipeline for BTCUSDT futures and spot. Binance WebSocket trade stream connects with auto-reconnect and exponential backoff (1s → 30s max). On reconnect, tradeId gaps are filled via REST API (`/fapi/v1/historicalTrades` / `/api/v3/historicalTrades`). Each trade flows through the aggregator (dedup, binning, bid/ask accumulation) and increments a Redis live-hash. At candle close, cells are flushed: rounded (half-up to 0.1), inserted into ClickHouse (`clusters_futures` / `clusters_spot`), live key deleted, and last-700 cache updated.

## Architecture

```
Binance WS → WSClient → Aggregator → Redis IncrCell (live hash)
                        ↓ (on candle close)
              CandleCloser → Flush → ClickHouse BatchInsert
                                   → Redis SetLastCandle (cache)
                                   → Redis DelAggKey (cleanup)
```

**Files:**
- `internal/ingest/ws_client.go` — WS client with reconnect, gap-fill, trade processing
- `internal/ingest/closer.go` — Candle closer goroutine with nextCloseTime
- `internal/store/clickhouse.go` — ClickHouse client, migrations, batch insert
- `cmd/server/main.go` — Startup orchestration (signal handling, goroutines)

**Key Types:**
- `WSConfig` — per-instance config (symbol, market, tickSize, compression, timeframe, RedisKeyFn)
- `WSClient` — WS connection manager with backoff
- `CandleCloser` — periodic flush goroutine
- `ClickHouse` — CH client wrapper
- `ClusterRow` — batch insert row

## Usage

```bash
# Environment variables
export PORT=8080
export REDIS_URL=localhost:6379
export CLICKHOUSE_URL=clickhouse://localhost:9000
export MIGRATIONS_PATH=migrations/001_init.sql

# Run
cd backend && go run ./cmd/server/
```

Ticker configs are hardcoded in main.go (2 symbols × multiple TFs). Migration runs on startup. WS clients and closers start as goroutines.

## Verification

- **Unit tests:** All pass (aggregator, binning, rounding, WS client, closer)
- **Build:** `go build ./...` succeeds
- **Integration test:** `INTEGRATION=1 go test -tags=integration ./internal/ingest/` — connects to real Binance WS, verifies trade arrival

## Journey Log

- [lesson] clickhouse-go v2 `Addr` field is `[]string`, not `string` — use `ParseDSN` instead of manual parsing
- [lesson] Go embed cannot reference parent directories (`../../`) — switched to runtime file read for migrations

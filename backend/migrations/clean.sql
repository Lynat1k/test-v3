CREATE TABLE IF NOT EXISTS ticker_config
(
    symbol                 LowCardinality(String),
    market                 Enum8('spot'=1,'futures'=2),
    tick_size              Decimal(18, 8),
    base_compression       UInt32,
    compression_levels     UInt8 DEFAULT 10,
    default_compression    UInt32 DEFAULT 25,
    ttl_days               UInt32,
    dom_snapshot_seconds   UInt32 DEFAULT 60,
    enabled                UInt8 DEFAULT 1,
    updated_at             DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (symbol, market);
INSERT INTO ticker_config (symbol, market, tick_size, base_compression, compression_levels, default_compression, ttl_days, dom_snapshot_seconds)
VALUES
    ('BTCUSDT', 'futures', 0.1, 25, 10, 25, 365, 60),
    ('BTCUSDT', 'spot',    0.01, 500, 10, 500, 1095, 900);
CREATE TABLE IF NOT EXISTS clusters_futures
(
    symbol        LowCardinality(String),
    timeframe     LowCardinality(String),
    candle_time   DateTime,
    price         Decimal(18, 1),
    bid           Decimal(18, 1),
    ask           Decimal(18, 1),
    volume        Decimal(18, 1) MATERIALIZED bid + ask,
    is_poc        UInt8 DEFAULT 0,
    updated_at    DateTime DEFAULT now(),
    INDEX idx_price price TYPE minmax GRANULARITY 4
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(candle_time)
ORDER BY (symbol, timeframe, candle_time, price)
TTL candle_time + INTERVAL 365 DAY DELETE
SETTINGS index_granularity = 8192;
CREATE TABLE IF NOT EXISTS clusters_spot
(
    symbol        LowCardinality(String),
    timeframe     LowCardinality(String),
    candle_time   DateTime,
    price         Decimal(18, 1),
    bid           Decimal(18, 1),
    ask           Decimal(18, 1),
    volume        Decimal(18, 1) MATERIALIZED bid + ask,
    is_poc        UInt8 DEFAULT 0,
    updated_at    DateTime DEFAULT now(),
    INDEX idx_price price TYPE minmax GRANULARITY 4
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(candle_time)
ORDER BY (symbol, timeframe, candle_time, price)
TTL candle_time + INTERVAL 1095 DAY DELETE
SETTINGS index_granularity = 8192;
CREATE TABLE IF NOT EXISTS dom_snapshots_futures
(
    symbol      LowCardinality(String),
    snap_time   DateTime,
    price       Decimal(18, 1),
    bid_qty     Decimal(18, 1),
    ask_qty     Decimal(18, 1),
    updated_at  DateTime DEFAULT now(),
    INDEX idx_price price TYPE minmax GRANULARITY 4
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(snap_time)
ORDER BY (symbol, snap_time, price)
TTL snap_time + INTERVAL 90 DAY DELETE;
CREATE TABLE IF NOT EXISTS dom_snapshots_spot
(
    symbol      LowCardinality(String),
    snap_time   DateTime,
    price       Decimal(18, 1),
    bid_qty     Decimal(18, 1),
    ask_qty     Decimal(18, 1),
    updated_at  DateTime DEFAULT now(),
    INDEX idx_price price TYPE minmax GRANULARITY 4
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(snap_time)
ORDER BY (symbol, snap_time, price)
TTL snap_time + INTERVAL 90 DAY DELETE;

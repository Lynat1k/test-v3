package aggregate

// ClusterCell represents a single price level within a cluster candle.
type ClusterCell struct {
	Price float64 `json:"price"`
	Bid   float64 `json:"bid"`
	Ask   float64 `json:"ask"`
}

// Volume returns bid + ask.
func (c ClusterCell) Volume() float64 {
	return c.Bid + c.Ask
}

// ClusterCandle represents one aggregated candle with cluster cells.
type ClusterCandle struct {
	Time   int64         `json:"time"`
	Open   float64       `json:"open"`
	High   float64       `json:"high"`
	Low    float64       `json:"low"`
	Close  float64       `json:"close"`
	Volume float64       `json:"volume"`
	Delta  float64       `json:"delta"`
	Cells  []ClusterCell `json:"cells"`
}

// Trade represents a raw Binance trade.
type Trade struct {
	TradeID       int64
	Price         float64
	Qty           float64
	TradeTimeMs   int64
	IsBuyerMaker  bool
}

// TickerConfig holds per-ticker parameters from ClickHouse.
type TickerConfig struct {
	Symbol            string
	Market            string
	TickSize          float64
	BaseCompression   uint32
	CompressionLevels uint8
	DefaultCompression uint32
	TTLDays           uint32
	DOMSnapshotSec    uint32
	Enabled           bool
}

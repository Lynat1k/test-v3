package api

type APIResponse struct {
	OK    bool        `json:"ok"`
	Data  interface{} `json:"data,omitempty"`
	Error *APIError   `json:"error,omitempty"`
}

type APIError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type CandlesData struct {
	Candles        []CandleJSON `json:"candles"`
	HistoryLimited bool         `json:"history_limited"`
}

type CandleJSON struct {
	Time   int64     `json:"time"`
	Open   float64   `json:"open"`
	High   float64   `json:"high"`
	Low    float64   `json:"low"`
	Close  float64   `json:"close"`
	Volume float64   `json:"volume"`
	Delta  float64   `json:"delta"`
	Cells  []CellJSON `json:"cells"`
}

type CellJSON struct {
	Price          float64 `json:"price"`
	Bid            float64 `json:"bid"`
	Ask            float64 `json:"ask"`
	Volume         float64 `json:"volume"`
	IsPoc          bool    `json:"isPoc"`
	IsBuyImbalance bool    `json:"isBuyImbalance"`
	IsSellImbalance bool   `json:"isSellImbalance"`
}

type DOMData struct {
	Bids     []DOMLevel `json:"bids"`
	Asks     []DOMLevel `json:"asks"`
	MidPrice float64    `json:"mid_price"`
	Updated  int64      `json:"updated"`
}

type DOMLevel struct {
	Price float64 `json:"price"`
	Qty   float64 `json:"qty"`
}

type FearGreedData struct {
	Value       int    `json:"value"`
	Classification string `json:"classification"`
	Timestamp  int64  `json:"timestamp"`
}

type TickerItem struct {
	Symbol            string   `json:"symbol"`
	Market            string   `json:"market"`
	TickSize          float64  `json:"tick_size"`
	BaseCompression   uint32   `json:"base_compression"`
	CompressionLevels uint8    `json:"compression_levels"`
	DefaultCompression uint32  `json:"default_compression"`
	Timeframes        []string `json:"timeframes"`
}

func okResponse(data interface{}) APIResponse {
	return APIResponse{OK: true, Data: data}
}

func errResponse(code, msg string) APIResponse {
	return APIResponse{
		OK:    false,
		Error: &APIError{Code: code, Message: msg},
	}
}

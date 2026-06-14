package api

import (
	"strings"

	"procluster-backend/internal/aggregate"
)

type Validator struct {
	configs map[string]aggregate.TickerConfig // key: "symbol:market"
}

func NewValidator(configs []aggregate.TickerConfig) *Validator {
	m := make(map[string]aggregate.TickerConfig, len(configs))
	for _, tc := range configs {
		m[tc.Symbol+":"+tc.Market] = tc
	}
	return &Validator{configs: m}
}

func (v *Validator) GetConfig(symbol, market string) (aggregate.TickerConfig, bool) {
	tc, ok := v.configs[strings.ToUpper(symbol)+":"+strings.ToLower(market)]
	return tc, ok
}

func (v *Validator) AllConfigs() []aggregate.TickerConfig {
	out := make([]aggregate.TickerConfig, 0, len(v.configs))
	for _, tc := range v.configs {
		out = append(out, tc)
	}
	return out
}

func (v *Validator) ValidateSymbolMarket(symbol, market string) (aggregate.TickerConfig, error) {
	symbol = strings.ToUpper(symbol)
	market = strings.ToLower(market)

	if symbol == "" {
		return aggregate.TickerConfig{}, errResp("INVALID_PARAMS", "symbol is required")
	}
	if market == "" {
		return aggregate.TickerConfig{}, errResp("INVALID_PARAMS", "market is required")
	}
	if market != "futures" && market != "spot" {
		return aggregate.TickerConfig{}, errResp("INVALID_PARAMS", "market must be 'futures' or 'spot'")
	}

	tc, ok := v.GetConfig(symbol, market)
	if !ok {
		return aggregate.TickerConfig{}, errResp("UNKNOWN_TICKER", "unknown symbol/market: "+symbol+"/"+market)
	}
	return tc, nil
}

func (v *Validator) ValidateTF(tf string, tc aggregate.TickerConfig) error {
	if tf == "" {
		return errResp("INVALID_PARAMS", "tf (timeframe) is required")
	}
	validTFs := validTimeframes(tc.Market)
	for _, vtf := range validTFs {
		if tf == vtf {
			return nil
		}
	}
	return errResp("INVALID_PARAMS", "invalid timeframe '"+tf+"' for "+tc.Market)
}

func (v *Validator) ValidateCompression(comp uint32, tc aggregate.TickerConfig) error {
	if comp == 0 {
		return nil
	}
	if comp < tc.BaseCompression {
		return errResp("INVALID_PARAMS", "compression must be >= base_compression")
	}
	maxComp := tc.BaseCompression * uint32(tc.CompressionLevels)
	if comp > maxComp {
		return errResp("INVALID_PARAMS", "compression must be <= base_compression * levels")
	}
	if comp%tc.BaseCompression != 0 {
		return errResp("INVALID_PARAMS", "compression must be a multiple of base_compression")
	}
	return nil
}

func validTimeframes(market string) []string {
	if market == "spot" {
		return []string{"15m", "30m", "1h", "4h"}
	}
	return []string{"1m", "5m", "15m", "30m", "1h", "4h"}
}

type validateError struct {
	code    string
	message string
}

func (e validateError) Error() string {
	return e.message
}

func errResp(code, msg string) validateError {
	return validateError{code: code, message: msg}
}

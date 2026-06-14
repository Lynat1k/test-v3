package history

import (
	"bufio"
	"io"
	"strconv"
	"strings"

	"procluster-backend/internal/aggregate"
)

// ParseFuturesCSV parses a comma-delimited Binance futures trades CSV from data.binance.vision.
// Format: id,price,qty,quote_qty,time,is_buyer_maker (WITH header row, 6 columns)
func ParseFuturesCSV(r io.Reader) ([]aggregate.Trade, error) {
	var trades []aggregate.Trade
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 64*1024), 256*1024)

	lineNum := 0
	for scanner.Scan() {
		lineNum++
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		// Skip header row
		if lineNum == 1 && strings.HasPrefix(line, "id") {
			continue
		}
		t, err := parseFuturesLine(line)
		if err != nil {
			continue
		}
		trades = append(trades, t)
	}
	return trades, scanner.Err()
}

// parseFuturesLine parses a single futures trade line.
// Format: id,price,qty,quote_qty,time,is_buyer_maker
func parseFuturesLine(line string) (aggregate.Trade, error) {
	parts := strings.Split(line, ",")
	if len(parts) < 6 {
		return aggregate.Trade{}, io.ErrUnexpectedEOF
	}

	tradeID, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return aggregate.Trade{}, err
	}
	price, err := strconv.ParseFloat(parts[1], 64)
	if err != nil {
		return aggregate.Trade{}, err
	}
	qty, err := strconv.ParseFloat(parts[2], 64)
	if err != nil {
		return aggregate.Trade{}, err
	}
	timeMs, err := strconv.ParseInt(parts[4], 10, 64)
	if err != nil {
		return aggregate.Trade{}, err
	}
	isBuyerMaker := strings.EqualFold(parts[5], "true")

	return aggregate.Trade{
		TradeID:      tradeID,
		Price:        price,
		Qty:          qty,
		TradeTimeMs:  timeMs,
		IsBuyerMaker: isBuyerMaker,
	}, nil
}

// ParseSpotCSV parses a comma-delimited Binance spot trades CSV from data.binance.vision.
// Format: id,price,qty,quote_qty,time,is_buyer_maker,is_best_match (NO header row, 7 columns)
// Timestamp is in MICROSECONDS (from Jan 2025 onward), so we divide by 1000.
func ParseSpotCSV(r io.Reader) ([]aggregate.Trade, error) {
	var trades []aggregate.Trade
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 64*1024), 256*1024)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		t, err := parseSpotLine(line)
		if err != nil {
			continue
		}
		trades = append(trades, t)
	}
	return trades, scanner.Err()
}

// parseSpotLine parses a single spot trade line.
// Format: id,price,qty,quote_qty,time,is_buyer_maker[,is_best_match]
func parseSpotLine(line string) (aggregate.Trade, error) {
	parts := strings.Split(line, ",")
	if len(parts) < 6 {
		return aggregate.Trade{}, io.ErrUnexpectedEOF
	}

	tradeID, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return aggregate.Trade{}, err
	}
	price, err := strconv.ParseFloat(parts[1], 64)
	if err != nil {
		return aggregate.Trade{}, err
	}
	qty, err := strconv.ParseFloat(parts[2], 64)
	if err != nil {
		return aggregate.Trade{}, err
	}
	timeRaw, err := strconv.ParseInt(parts[4], 10, 64)
	if err != nil {
		return aggregate.Trade{}, err
	}

	// Spot timestamps: microseconds since 2025-01-01, older data was milliseconds.
	// Heuristic: if timeRaw > 1e15, it's microseconds; else milliseconds.
	timeMs := timeRaw
	if timeRaw > 1e15 {
		timeMs = timeRaw / 1000
	}

	isBuyerMaker := strings.EqualFold(parts[5], "true")

	return aggregate.Trade{
		TradeID:      tradeID,
		Price:        price,
		Qty:          qty,
		TradeTimeMs:  timeMs,
		IsBuyerMaker: isBuyerMaker,
	}, nil
}

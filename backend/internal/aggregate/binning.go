package aggregate

import "math"

// BinPriceLow returns the lower boundary of the price bin for a given trade price.
// binSize = compression * tickSize
// binIndex = floor(price / binSize)
// binPriceLow = binIndex * binSize
func BinPriceLow(price, tickSize float64, compression uint32) float64 {
	binSize := float64(compression) * tickSize
	return math.Floor(price/binSize) * binSize
}

package aggregate

import (
	"testing"
)

func TestBinPriceLow(t *testing.T) {
	tests := []struct {
		name        string
		price       float64
		tickSize    float64
		compression uint32
		expected    float64
	}{
		// Futures: tickSize=0.1, compression=25 → binSize=2.5
		{"B1: 100.0 exact", 100.0, 0.1, 25, 100.0},
		{"B2: 102.4 → 100.0", 102.4, 0.1, 25, 100.0},
		{"B3: 102.5 exact", 102.5, 0.1, 25, 102.5},
		{"B4: 104.99 → 102.5", 104.99, 0.1, 25, 102.5},
		{"B5: 105.0 exact", 105.0, 0.1, 25, 105.0},
		{"B9: 0.005 → 0.0", 0.005, 0.1, 25, 0.0},
		{"B10: 99999.5 → 99997.5", 99999.5, 0.1, 25, 99997.5},

		// Spot: tickSize=0.01, compression=500 → binSize=5.0
		{"B6: 5.00 spot exact", 5.00, 0.01, 500, 5.00},
		{"B7: 9.99 spot → 5.00", 9.99, 0.01, 500, 5.00},
		{"B8: 10.00 spot exact", 10.00, 0.01, 500, 10.00},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := BinPriceLow(tt.price, tt.tickSize, tt.compression)
			diff := got - tt.expected
			if diff > 0.0001 || diff < -0.0001 {
				t.Errorf("BinPriceLow(%v, %v, %v) = %v, want %v",
					tt.price, tt.tickSize, tt.compression, got, tt.expected)
			}
		})
	}
}

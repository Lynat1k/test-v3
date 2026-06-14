package aggregate

import (
	"testing"
)

func TestRoundHalfUp(t *testing.T) {
	tests := []struct {
		name     string
		input    float64
		expected float64
	}{
		{"R1: 5.1256 → 5.1", 5.1256, 5.1},
		{"R2: 5.627 → 5.6", 5.627, 5.6},
		{"R3: 5.65 → 5.7 (half-up)", 5.65, 5.7},
		{"R4: 0.0125 → 0", 0.0125, 0.0},
		{"R5: 0.85 → 0.9 (half-up)", 0.85, 0.9},
		{"R6: 0.05 → 0.1 (half-up)", 0.05, 0.1},
		{"R7: 0.04 → 0", 0.04, 0.0},
		{"R8: 0.0 → 0", 0.0, 0.0},
		{"R9: 99.99 → 100.0", 99.99, 100.0},
		{"R10: -0.05 → -0.1 (half-up)", -0.05, -0.1},
		{"R11: 0.75 → 0.8 (half-up)", 0.75, 0.8},
		{"R12: 0.15 → 0.2 (half-up)", 0.15, 0.2},
		{"R13: 1.25 → 1.3 (half-up)", 1.25, 1.3},
		{"R14: 2.35 → 2.4 (half-up)", 2.35, 2.4},
		{"R15: -1.75 → -1.8 (half-up)", -1.75, -1.8},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := RoundHalfUp(tt.input)
			if diff := got - tt.expected; diff > 0.0001 || diff < -0.0001 {
				t.Errorf("RoundHalfUp(%v) = %v, want %v", tt.input, got, tt.expected)
			}
		})
	}
}

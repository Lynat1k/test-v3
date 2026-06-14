package ingest

import (
	"testing"
	"time"
)

func TestCandleCloser_NextCloseTime(t *testing.T) {
	tests := []struct {
		name string
		tf   string
		now  time.Time
		want time.Time
	}{
		{
			"1m: now=12:00:30 → close=12:01:00",
			"1m",
			time.Date(2024, 6, 14, 12, 0, 30, 0, time.UTC),
			time.Date(2024, 6, 14, 12, 1, 0, 0, time.UTC),
		},
		{
			"5m: now=12:03:00 → close=12:05:00",
			"5m",
			time.Date(2024, 6, 14, 12, 3, 0, 0, time.UTC),
			time.Date(2024, 6, 14, 12, 5, 0, 0, time.UTC),
		},
		{
			"1h: now=12:30:00 → close=13:00:00",
			"1h",
			time.Date(2024, 6, 14, 12, 30, 0, 0, time.UTC),
			time.Date(2024, 6, 14, 13, 0, 0, 0, time.UTC),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := nextCloseTime(tt.now, tt.tf)
			if !got.Equal(tt.want) {
				t.Errorf("nextCloseTime(%v, %q) = %v, want %v", tt.now, tt.tf, got, tt.want)
			}
		})
	}
}

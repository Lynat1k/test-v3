package aggregate

import (
	"strconv"
	"strings"
)

// RoundHalfUp rounds a float64 to 1 decimal place using round half up.
// Uses decimal string representation for determinism (avoids float arithmetic errors).
//
// Rule: examine the second decimal digit (d2).
//   - d2 < 5 → truncate (keep first decimal as-is)
//   - d2 >= 5 → increment first decimal by 1 (with carry)
//
// Examples: 5.65 → 5.7, 0.05 → 0.1, 0.04 → 0.0, 0.85 → 0.9, -0.05 → -0.1
func RoundHalfUp(v float64) float64 {
	if v == 0 {
		return 0
	}

	sign := 1.0
	abs := v
	if v < 0 {
		sign = -1.0
		abs = -v
	}

	s := strconv.FormatFloat(abs, 'f', -1, 64)

	dotIdx := strings.Index(s, ".")
	if dotIdx < 0 || dotIdx+2 >= len(s) {
		return v
	}

	d1 := int(s[dotIdx+1] - '0')
	d2 := int(s[dotIdx+2] - '0')

	if d2 >= 5 {
		d1++
	}

	intPart, _ := strconv.ParseInt(s[:dotIdx], 10, 64)

	if d1 >= 10 {
		d1 = 0
		intPart++
	}

	return sign * (float64(intPart) + float64(d1)/10.0)
}

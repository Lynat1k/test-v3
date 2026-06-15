package api

import (
	"os"
	"strings"
)

// defaultOrigins is the fallback whitelist when CORS_ALLOWED_ORIGINS env is empty.
var defaultOrigins = []string{
	// Dev
	"http://localhost:5180",
	"http://localhost:5181",
	"http://127.0.0.1:5180",
	"http://127.0.0.1:5181",
	// Production
	"https://procluster.online",
	"https://chart.procluster.online",
	"https://www.procluster.online",
	"https://www.chart.procluster.online",
}

// AllowedOrigins returns the full origin whitelist, built from env or defaults.
func AllowedOrigins() map[string]bool {
	raw := os.Getenv("CORS_ALLOWED_ORIGINS")
	var origins []string
	if raw != "" {
		origins = strings.Split(raw, ",")
	} else {
		origins = defaultOrigins
	}

	m := make(map[string]bool, len(origins))
	for _, o := range origins {
		o = strings.TrimSpace(o)
		if o != "" {
			m[o] = true
		}
	}
	return m
}

// IsOriginAllowed checks if the given Origin header value is in the whitelist.
// Matches full origin (scheme://host:port), not just host.
func IsOriginAllowed(origin string) bool {
	if origin == "" {
		return false
	}
	return AllowedOrigins()[origin]
}

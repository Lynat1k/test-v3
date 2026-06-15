package proxy

import (
	"context"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"golang.org/x/net/proxy"
)

var (
	httpClient *http.Client
	wsDialer   proxy.Dialer
	enabled    bool
	proxyAddr  string
)

func init() {
	raw := strings.TrimSpace(os.Getenv("BINANCE_PROXY"))
	if raw == "" {
		log.Println("Binance proxy: disabled (direct)")
		httpClient = &http.Client{Timeout: 10 * time.Minute}
		wsDialer = proxy.Direct
		return
	}

	enabled = true
	proxyAddr = raw

	dialer, err := proxy.SOCKS5("tcp", stripScheme(raw), nil, proxy.Direct)
	if err != nil {
		log.Fatalf("Binance proxy: invalid SOCKS5 address %q: %v", raw, err)
	}

	wsDialer = dialer
	httpClient = &http.Client{
		Timeout: 10 * time.Minute,
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				return dialer.(proxy.ContextDialer).DialContext(ctx, network, addr)
			},
			MaxIdleConns:          10,
			IdleConnTimeout:       90 * time.Second,
			TLSHandshakeTimeout:   10 * time.Second,
			ExpectContinueTimeout: 1 * time.Second,
		},
	}

	log.Printf("Binance proxy: enabled (%s)", raw)
}

// stripScheme removes socks5:// prefix from address.
func stripScheme(raw string) string {
	s := strings.TrimPrefix(raw, "socks5://")
	s = strings.TrimPrefix(s, "socks5h://")
	return s
}

// HTTPClient returns an HTTP client routed through the proxy (or direct).
func HTTPClient() *http.Client {
	return httpClient
}

// WSDialer returns a dialer for WebSocket connections through the proxy (or direct).
func WSDialer() proxy.Dialer {
	return wsDialer
}

// Enabled reports whether a proxy is configured.
func Enabled() bool {
	return enabled
}

// Addr returns the proxy address string (empty if disabled).
func Addr() string {
	return proxyAddr
}

// ProxyURL parses the proxy address into a *url.URL (for websocket.Dialer.Proxy).
func ProxyURL() *url.URL {
	if !enabled {
		return nil
	}
	u, err := url.Parse(proxyAddr)
	if err != nil {
		return nil
	}
	return u
}

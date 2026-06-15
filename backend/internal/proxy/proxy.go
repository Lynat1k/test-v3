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
	httpClient    *http.Client
	wsProxyFunc   func(*http.Request) (*url.URL, error) // for websocket.Dialer.Proxy
	enabled       bool
	proxyAddr     string
	proxyScheme   string // "socks5" or "http"
)

func init() {
	raw := strings.TrimSpace(os.Getenv("BINANCE_PROXY"))
	if raw == "" {
		log.Println("Binance proxy: disabled (direct)")
		httpClient = &http.Client{Timeout: 10 * time.Minute}
		wsProxyFunc = nil
		return
	}

	u, err := url.Parse(raw)
	if err != nil {
		log.Fatalf("Binance proxy: invalid URL %q: %v", raw, err)
	}

	scheme := strings.ToLower(u.Scheme)
	switch scheme {
	case "socks5", "socks5h":
		initSOCKS5(u, raw)
	case "http", "https":
		initHTTP(u, raw)
	default:
		log.Fatalf("Binance proxy: unsupported scheme %q (use socks5:// or http://)", scheme)
	}
}

func initSOCKS5(u *url.URL, raw string) {
	proxyScheme = "socks5"
	enabled = true
	proxyAddr = raw

	addr := u.Host
	if u.Port() == "" {
		addr = addr + ":1080"
	}

	dialer, err := proxy.SOCKS5("tcp", addr, nil, proxy.Direct)
	if err != nil {
		log.Fatalf("Binance proxy: SOCKS5 dial error: %v", err)
	}

	// HTTP client via SOCKS5 DialContext
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

	// WS: gorilla websocket.Dialer doesn't natively support SOCKS5,
	// but we can use a custom NetDial. For simplicity, use proxyURL
	// which gorilla will try as HTTP CONNECT — won't work for SOCKS5.
	// Instead, set a custom NetDial that goes through SOCKS5.
	wsProxyFunc = nil // ws_client.go will use custom dialer when wsProxyFunc is nil

	log.Printf("Binance proxy: enabled (%s)", raw)
}

func initHTTP(u *url.URL, raw string) {
	proxyScheme = "http"
	enabled = true
	proxyAddr = raw

	// HTTP client: standard Go proxy support
	httpClient = &http.Client{
		Timeout: 10 * time.Minute,
		Transport: &http.Transport{
			Proxy: http.ProxyURL(u),
			MaxIdleConns:          10,
			IdleConnTimeout:       90 * time.Second,
			TLSHandshakeTimeout:   10 * time.Second,
			ExpectContinueTimeout: 1 * time.Second,
		},
	}

	// WS: gorilla websocket.Dialer supports HTTP CONNECT proxy natively
	wsProxyFunc = func(_ *http.Request) (*url.URL, error) {
		return u, nil
	}

	log.Printf("Binance proxy: enabled (%s)", raw)
}

// HTTPClient returns an HTTP client routed through the proxy (or direct).
func HTTPClient() *http.Client {
	return httpClient
}

// WSProxyFunc returns the proxy function for websocket.Dialer.Proxy.
// Returns nil for SOCKS5 (ws_client.go handles SOCKS5 via custom NetDial).
func WSProxyFunc() func(*http.Request) (*url.URL, error) {
	return wsProxyFunc
}

// WSNeedsCustomDial returns true if WS needs a custom SOCKS5 dialer
// (gorilla doesn't support SOCKS5 natively via Proxy func).
func WSNeedsCustomDial() bool {
	return enabled && proxyScheme == "socks5"
}

// WSSOCKS5Dialer returns the SOCKS5 dialer for WS connections.
// Only valid when WSNeedsCustomDial() is true.
func WSSOCKS5Dialer() proxy.Dialer {
	u, _ := url.Parse(proxyAddr)
	addr := u.Host
	if u.Port() == "" {
		addr = addr + ":1080"
	}
	dialer, err := proxy.SOCKS5("tcp", addr, nil, proxy.Direct)
	if err != nil {
		log.Fatalf("Binance proxy: SOCKS5 dial error: %v", err)
	}
	return dialer
}

// Enabled reports whether a proxy is configured.
func Enabled() bool {
	return enabled
}

// Addr returns the proxy address string (empty if disabled).
func Addr() string {
	return proxyAddr
}

// Scheme returns the proxy scheme ("socks5", "http", or "").
func Scheme() string {
	return proxyScheme
}

// ProxyURL parses the proxy address into a *url.URL.
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

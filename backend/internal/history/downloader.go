package history

import (
	"archive/zip"
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"procluster-backend/internal/proxy"
)

// data.binance.vision URL patterns:
// Futures: data/trade/futures/um/{symbol}/daily/{YYYY-MM-DD}/{symbol}-trades-{YYYY-MM-DD}.zip
// Spot:    data/trade/spot/daily/{symbol}/{YYYY-MM-DD}/{symbol}-trades-{YYYY-MM-DD}.zip

// downloadURL returns the full download URL for a given symbol, market, and date.
func downloadURL(symbol, market, date string) string {
	if market == "futures" {
		return fmt.Sprintf("https://data.binance.vision/data/futures/um/daily/trades/%s/%s-trades-%s.zip",
			symbol, symbol, date)
	}
	return fmt.Sprintf("https://data.binance.vision/data/spot/daily/trades/%s/%s-trades-%s.zip",
		symbol, symbol, date)
}

// DownloadAndExtract downloads a daily trades ZIP from data.binance.vision,
// extracts the CSV to destDir, and returns the path to the extracted CSV file.
// Uses a shared HTTP client with rate limiting (1 req/sec).
func DownloadAndExtract(ctx context.Context, symbol, market, date, destDir string, client *http.Client) (string, error) {
	url := downloadURL(symbol, market, date)

	if err := os.MkdirAll(destDir, 0755); err != nil {
		return "", fmt.Errorf("mkdir: %w", err)
	}

	zipPath := filepath.Join(destDir, fmt.Sprintf("%s-trades-%s.zip", symbol, date))

	// Download if not cached (or if cached file is corrupt)
	if info, err := os.Stat(zipPath); os.IsNotExist(err) || (err == nil && info.Size() == 0) {
		if err := os.Remove(zipPath); err != nil && !os.IsNotExist(err) {
			return "", err
		}
		if err := downloadFile(ctx, url, zipPath, client); err != nil {
			return "", fmt.Errorf("download: %w", err)
		}
	}

	// Extract CSV from ZIP
	csvPath, err := extractCSV(zipPath, destDir)
	if err != nil {
		return "", fmt.Errorf("extract: %w", err)
	}

	return csvPath, nil
}

func downloadFile(ctx context.Context, url, dest string, client *http.Client) error {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return err
	}

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return fmt.Errorf("not found: %s", url)
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, url)
	}

	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer f.Close()

	_, err = io.Copy(f, resp.Body)
	return err
}

func extractCSV(zipPath, destDir string) (string, error) {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return "", err
	}
	defer r.Close()

	for _, f := range r.File {
		if strings.HasSuffix(f.Name, ".csv") {
			csvPath := filepath.Join(destDir, filepath.Base(f.Name))

			// Skip if already extracted
			if _, err := os.Stat(csvPath); err == nil {
				return csvPath, nil
			}

			outFile, err := os.Create(csvPath)
			if err != nil {
				return "", err
			}
			defer outFile.Close()

			rc, err := f.Open()
			if err != nil {
				return "", err
			}
			defer rc.Close()

			_, err = io.Copy(outFile, rc)
			return csvPath, err
		}
	}

	return "", fmt.Errorf("no CSV found in %s", zipPath)
}

// DateRange returns all dates (YYYY-MM-DD) between from and to (inclusive).
func DateRange(from, to time.Time) []string {
	var dates []string
	d := from
	for !d.After(to) {
		dates = append(dates, d.Format("2006-01-02"))
		d = d.AddDate(0, 0, 1)
	}
	return dates
}

// NewRateLimitedClient returns an HTTP client with generous timeouts for large ZIP files.
// Uses proxy if BINANCE_PROXY is set.
func NewRateLimitedClient() *http.Client {
	return proxy.HTTPClient()
}

// LogProgress logs download/processing progress.
func LogProgress(label string, current, total int, extra string) {
	pct := 0
	if total > 0 {
		pct = current * 100 / total
	}
	log.Printf("[%s] %d/%d (%d%%) %s", label, current, total, pct, extra)
}

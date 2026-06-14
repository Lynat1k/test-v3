#!/bin/bash
# ws_test.sh — Test WebSocket hub
# Usage: bash ws_test.sh [server_url]
# Requires: websocat (https://github.com/nickel-chrome/websocat) or wscat

URL="${1:-ws://localhost:8090/ws}"

echo "=== WebSocket Hub Test ==="
echo "Connecting to: $URL"
echo ""

# Test 1: Subscribe to futures 1m
echo "--- Test 1: Subscribe to futures 1m ---"
echo '{"action":"subscribe","symbol":"BTCUSDT","market":"futures","tf":"1m","compression":25}' | timeout 5 websocat -n1 "$URL" 2>&1 || echo "(no response - server may not be running)"
echo ""

# Test 2: Subscribe with higher compression
echo "--- Test 2: Subscribe with compression=50 (×2 merge) ---"
echo '{"action":"subscribe","symbol":"BTCUSDT","market":"futures","tf":"1m","compression":50}' | timeout 5 websocat -n1 "$URL" 2>&1 || echo "(no response)"
echo ""

# Test 3: Invalid subscription
echo "--- Test 3: Invalid params ---"
echo '{"action":"subscribe","symbol":"FAKE","market":"futures","tf":"1m","compression":25}' | timeout 3 websocat -n1 "$URL" 2>&1 || echo "(no response)"
echo ""

# Test 4: Listen for updates (5 seconds)
echo "--- Test 4: Listening for realtime updates (5s) ---"
echo '{"action":"subscribe","symbol":"BTCUSDT","market":"futures","tf":"1m","compression":25}' | timeout 5 websocat -m 10 "$URL" 2>&1 || echo "(timeout - expected)"
echo ""

echo "=== Tests Complete ==="

#!/bin/bash
# ─────────────────────────────────────────────
#  ARX Dashboard Launcher
#  Double-click in Finder, or run from terminal.
#  Also used by the macOS login-item (LaunchAgent).
# ─────────────────────────────────────────────

BASE="$HOME/Documents/DailoOS"
ARXLIVE="$BASE/arx-live"
PROXY="$BASE/arx_kol_proxy.py"

echo ""
echo "  ╔══════════════════════════════════╗"
echo "  ║        ARX Dashboard             ║"
echo "  ╚══════════════════════════════════╝"
echo ""

# ── Kill any stale processes on our ports ──
echo "  → Clearing ports 8080 and 3001..."
lsof -ti:8080 | xargs kill -9 2>/dev/null
lsof -ti:3001 | xargs kill -9 2>/dev/null
sleep 1

# ── Start KOL / News proxy ─────────────────
if [ -f "$PROXY" ]; then
  echo "  → Starting proxy (port 3001)..."
  nohup python3 "$PROXY" > /tmp/arx_proxy.log 2>&1 &
  PROXY_PID=$!
  echo "     PID $PROXY_PID  |  logs → /tmp/arx_proxy.log"
else
  echo "  ⚠  Proxy not found at $PROXY — KOL / news features disabled."
fi

# ── Start HTTP server ──────────────────────
echo "  → Starting HTTP server (port 8080)..."
nohup python3 -m http.server 8080 --directory "$ARXLIVE" > /tmp/arx_server.log 2>&1 &
SERVER_PID=$!
echo "     PID $SERVER_PID  |  logs → /tmp/arx_server.log"

# ── Wait for server to be ready ───────────
echo ""
echo "  → Waiting for server..."
for i in {1..10}; do
  if curl -s http://localhost:8080 > /dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

# ── Open browser ──────────────────────────
echo "  → Opening http://localhost:8080"
open http://localhost:8080

echo ""
echo "  ✅  ARX Dashboard is live at http://localhost:8080"
echo ""
echo "  Close this window OR press Ctrl+C to stop both servers."
echo ""

# ── Keep window open + trap Ctrl+C ────────
cleanup() {
  echo ""
  echo "  Shutting down..."
  kill $SERVER_PID $PROXY_PID 2>/dev/null
  exit 0
}
trap cleanup INT TERM

# Block so the terminal stays open
wait $SERVER_PID

#!/bin/bash
# ─────────────────────────────────────────────
#  ARX Dashboard — macOS Login Item Installer
#  Run this ONCE to make ARX start on every login.
#
#  Usage:
#    chmod +x install-startup.sh
#    ./install-startup.sh
#
#  To uninstall:
#    launchctl unload ~/Library/LaunchAgents/com.arx.dashboard.plist
#    rm ~/Library/LaunchAgents/com.arx.dashboard.plist
# ─────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCHER="$SCRIPT_DIR/start-arx.command"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$PLIST_DIR/com.arx.dashboard.plist"

echo ""
echo "  ╔══════════════════════════════════╗"
echo "  ║   ARX Dashboard  — Auto-Start    ║"
echo "  ╚══════════════════════════════════╝"
echo ""

# ── Verify launcher exists ────────────────
if [ ! -f "$LAUNCHER" ]; then
  echo "  ✗  Cannot find start-arx.command at:"
  echo "     $LAUNCHER"
  echo "  Make sure you run this script from the arx-live folder."
  exit 1
fi

# ── Make scripts executable ───────────────
chmod +x "$LAUNCHER"
chmod +x "$0"

# ── Create LaunchAgents folder if missing ─
mkdir -p "$PLIST_DIR"

# ── Write LaunchAgent plist ───────────────
cat > "$PLIST_PATH" << PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>

  <!-- Unique identifier for this agent -->
  <key>Label</key>
  <string>com.arx.dashboard</string>

  <!-- Command to run: bash start-arx.command -->
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$LAUNCHER</string>
  </array>

  <!-- Run when user logs in -->
  <key>RunAtLoad</key>
  <true/>

  <!-- Do NOT restart if it exits normally -->
  <key>KeepAlive</key>
  <false/>

  <!-- Log output -->
  <key>StandardOutPath</key>
  <string>/tmp/arx_launchagent.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/arx_launchagent_err.log</string>

</dict>
</plist>
PLIST_EOF

echo "  → Plist written to:"
echo "     $PLIST_PATH"
echo ""

# ── Unload old version (if any) ───────────
launchctl unload "$PLIST_PATH" 2>/dev/null

# ── Load new agent ────────────────────────
launchctl load "$PLIST_PATH"

if [ $? -eq 0 ]; then
  echo "  ✅  Done! ARX Dashboard will now start automatically every time you log in."
  echo ""
  echo "  To disable auto-start:"
  echo "    launchctl unload $PLIST_PATH"
  echo "    rm $PLIST_PATH"
  echo ""
  echo "  To start right now (without restarting):"
  echo "    launchctl start com.arx.dashboard"
else
  echo "  ✗  launchctl failed — try running with sudo, or check System Settings > Privacy & Security."
fi
echo ""

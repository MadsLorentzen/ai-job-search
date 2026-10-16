#!/usr/bin/env bash
# Install (or remove with --uninstall) the two launchd jobs behind /linkedin:
#   com.aijobsearch.linkedin.publish   every 30 min: publish approved posts that are due
#   com.aijobsearch.linkedin.reminder  Monday 09:00: notification to run /linkedin
# They live in ~/Library/LaunchAgents and run as the current user only.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/Library/Logs/ai-job-search"
PY="$(command -v python3.13 || command -v python3)"
DATA="$HOME/.local/share/ai-job-search"
BIN="$DATA/bin"
PUB="com.aijobsearch.linkedin.publish"
REM="com.aijobsearch.linkedin.reminder"

if [[ "${1:-}" == "--uninstall" ]]; then
  for job in "$PUB" "$REM"; do
    launchctl bootout "gui/$(id -u)/$job" 2>/dev/null || true
    rm -f "$AGENTS/$job.plist"
  done
  echo "Removed LinkedIn schedule."
  exit 0
fi

mkdir -p "$AGENTS" "$LOGS" "$BIN" "$DATA/linkedin/queue"
# launchd cannot read files under ~/Desktop (macOS privacy rules), so the job
# runs a copy of the publisher kept next to the queue. Re-run this installer
# after changing tools/linkedin_post.py.
cp "$REPO/tools/linkedin_post.py" "$BIN/linkedin_post.py"

cat > "$AGENTS/$PUB.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$PUB</string>
  <key>ProgramArguments</key><array>
    <string>$PY</string><string>$BIN/linkedin_post.py</string><string>publish-due</string>
  </array>
  <key>WorkingDirectory</key><string>$DATA</string>
  <key>StartInterval</key><integer>1800</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOGS/linkedin-publish.log</string>
  <key>StandardErrorPath</key><string>$LOGS/linkedin-publish.log</string>
</dict></plist>
EOF

cat > "$AGENTS/$REM.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$REM</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/osascript</string><string>-e</string>
    <string>display notification "Run /linkedin in Claude Code for your weekly check-in and two posts." with title "LinkedIn check-in"</string>
  </array>
  <key>StartCalendarInterval</key><dict>
    <key>Weekday</key><integer>1</integer><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer>
  </dict>
</dict></plist>
EOF

for job in "$PUB" "$REM"; do
  launchctl bootout "gui/$(id -u)/$job" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/$job.plist"
done
echo "Installed: $PUB (every 30 min) and $REM (Mondays 09:00)."
echo "Publisher log: $LOGS/linkedin-publish.log"

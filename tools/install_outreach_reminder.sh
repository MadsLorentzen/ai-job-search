#!/usr/bin/env bash
# Install (or remove with --uninstall) a weekday 10:00 macOS notification to run
# `/outreach daily` (find recruiters, approve emails; approved ones are sent from
# chat). Nothing here sends mail. Re-running removes the old 16:00 drafts reminder.
set -euo pipefail

AGENTS="$HOME/Library/LaunchAgents"
JOB="com.aijobsearch.outreach.reminder"
JOB2="com.aijobsearch.outreach.send-reminder"

if [[ "${1:-}" == "--uninstall" ]]; then
  for j in "$JOB" "$JOB2"; do
    launchctl bootout "gui/$(id -u)/$j" 2>/dev/null || true
    rm -f "$AGENTS/$j.plist"
  done
  echo "Removed outreach reminders."
  exit 0
fi

mkdir -p "$AGENTS"
write_plist() {  # label hour message
  local label="$1" hour="$2" msg="$3"
  {
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/osascript</string><string>-e</string>
    <string>display notification "$msg" with title "Recruiter outreach"</string>
  </array>
  <key>StartCalendarInterval</key><array>
EOF
  for d in 1 2 3 4 5; do
    echo "    <dict><key>Weekday</key><integer>$d</integer><key>Hour</key><integer>$hour</integer><key>Minute</key><integer>0</integer></dict>"
  done
  cat <<EOF
  </array>
</dict></plist>
EOF
  } > "$AGENTS/$label.plist"
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/$label.plist"
}

write_plist "$JOB" 10 "Run /outreach daily in Claude Code: recruiter emails to review."
# The 16:00 "send your drafts" reminder belonged to draft mode; remove it if present.
launchctl bootout "gui/$(id -u)/$JOB2" 2>/dev/null || true
rm -f "$AGENTS/$JOB2.plist"
echo "Installed: $JOB (weekdays 10:00)."

# Running {{NAME}} unattended

The multi-agent search **within** a pass is fully automatic (the workflow). The weekly *cadence* needs an OS scheduler — in-session crons die when Claude exits. Two options; launchd is preferred on macOS.

The trigger is always the same one line — headless Claude Code, from the repo, with the loop's resume prompt:

```bash
cd <YOUR_PROJECT_DIR> && \
  claude -p "continue the {{NAME}} loop" --dangerously-skip-permissions >> \
  self-learning-loop/{{NAME}}/cron.log 2>&1
```

`--dangerously-skip-permissions` is what makes it unattended (no prompts). The scoped allow-list in `.claude/settings.local.json` already covers the loop's tools, so you can drop that flag if you prefer prompts to surface. Pick one.

> Caveat: the Atlassian (Confluence) MCP authenticates interactively and may be absent in a headless run. The loop grounds relevance primarily on the existing mindgap graph, so it still works without Confluence — Confluence is best-effort enrichment only.

## Option A — launchd (macOS, survives logout/reboot)
Write `~/Library/LaunchAgents/com.example.{{NAME}}.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.example.{{NAME}}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string><string>-lc</string>
    <string>cd <YOUR_PROJECT_DIR> && claude -p "continue the {{NAME}} loop" --dangerously-skip-permissions >> self-learning-loop/{{NAME}}/cron.log 2>&1</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>7</integer><key>Minute</key><integer>17</integer></dict>
  <key>StandardErrorPath</key><string><YOUR_PROJECT_DIR>/self-learning-loop/{{NAME}}/cron.err</string>
</dict>
</plist>
```

Load: `launchctl load ~/Library/LaunchAgents/com.example.{{NAME}}.plist`
(Monday 07:17. Unload with `launchctl unload <path>`.)

## Option B — cron
```cron
17 7 * * 1 cd <YOUR_PROJECT_DIR> && /opt/homebrew/bin/claude -p "continue the {{NAME}} loop" --dangerously-skip-permissions >> self-learning-loop/{{NAME}}/cron.log 2>&1
```

## Manual (no scheduler)
Just tell Claude in this repo: **"continue the {{NAME}} loop"** — loop-system reads STATE.md and runs the next pass.

Confirm a run landed: `mindgap find {{NAME}} --json` (new nodes this week) and the newest `artifacts/session-N/` dir.

#!/bin/sh
# Portable installer for mindgap. Idempotent. No personal paths.
set -e
REPO=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)   # this script's dir = repo root

# 1. Put `mindgap` + `mindgap-mcp` on PATH.
if command -v pipx >/dev/null 2>&1; then
  pipx install --force "$REPO"; MODE=pipx
elif python3 -m pip --version >/dev/null 2>&1; then
  python3 -m pip install --user "$REPO"; MODE=pip
  case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) echo "note: add \$HOME/.local/bin to PATH" >&2 ;; esac
else
  BIN=""
  for d in "$HOME/.local/bin" $(echo "$PATH" | tr : ' '); do
    if [ -d "$d" ] && [ -w "$d" ]; then BIN=$d; break; fi
  done
  [ -n "$BIN" ] || { mkdir -p "$HOME/.local/bin"; BIN="$HOME/.local/bin"; }
  ln -sf "$REPO/bin/mindgap" "$BIN/mindgap"
  ln -sf "$REPO/bin/mindgap-mcp" "$BIN/mindgap-mcp"
  MODE=source; echo "linked $BIN/mindgap (source mode)"
fi

# 2. Seed if empty.
mindgap init     2>/dev/null || python3 -m mindgap init

# 3. Optional: the mindtop TUI. Needs a Rust toolchain, and mindgap must stay
#    installable without one — so a missing cargo is a notice, and a FAILED
#    build is a notice too. The `if !` form is deliberate: a bare command under
#    `set -e` would abort the whole installer after step 1 already succeeded.
if command -v cargo >/dev/null 2>&1; then
  echo "building mindtop (Rust TUI)..."
  if ! cargo install --path tui --root "$HOME/.local" --locked; then
    echo "note: mindtop build failed; mindgap itself is installed and usable" >&2
  fi
else
  echo "note: cargo not found — skipping the optional mindtop TUI" >&2
fi

# 4. Next steps.
echo
echo "installed ($MODE). data dir: ${MINDGAP_HOME:-$HOME/.mindgap}"
echo "  mindgap serve                          # web UI at http://localhost:8765"
echo "  mindtop                                # terminal UI (if the build above succeeded)"
echo "  claude mcp add mindgap mindgap-mcp     # register MCP for Claude Code (after pip/pipx)"
echo "  /plugin marketplace add grburgess/mindgap && /plugin install mindgap   # skills + MCP"

#!/usr/bin/env bash
# Probe optional/required tools for arxiv-explainer. Always exits 0.
set -u

report_cmd() {
  if command -v "$1" >/dev/null 2>&1; then echo "$1: ok"; else echo "$1: missing"; fi
}
report_pylib() {
  if python3 -c "import $2" >/dev/null 2>&1; then echo "$1: ok"; else echo "$1: missing"; fi
}

# CLI tools
for c in python3 mindgap ffmpeg manim pdftoppm; do report_cmd "$c"; done
# Python libs (import name in 2nd arg)
report_pylib pymupdf fitz
report_pylib pillow PIL

exit 0

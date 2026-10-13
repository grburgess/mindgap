#!/usr/bin/env bash
# Backport hand edits made to the generated skills (mindgap-plugin/skills/)
# to the upstream repo they are exported from, so the next export keeps them.
#
#   tools/backport-skills.sh                      # print the patch
#   tools/backport-skills.sh <UPSTREAM_SKILLS_DIR>  # apply it there
#
# The base is the last export: the newest commit touching skills/GENERATED,
# which every export rewrites. Only committed edits since then are included.
# Applying is all-or-nothing: if any hunk doesn't fit (upstream diverged),
# nothing is changed and the failing hunks are reported.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
SKILLS=mindgap-plugin/skills

base=$(git log -1 --format=%H -- "$SKILLS/GENERATED")
[ -n "$base" ] || { echo "no export commit found ($SKILLS/GENERATED has no history)" >&2; exit 1; }

patch_text=$(git diff --no-color --relative="$SKILLS" "$base" HEAD -- "$SKILLS" ":(exclude)$SKILLS/GENERATED")

if [ $# -eq 0 ]; then
  [ -z "$patch_text" ] || printf '%s\n' "$patch_text"
  exit 0
fi

dest=$1
[ -d "$dest" ] || { echo "not a directory: $dest" >&2; exit 1; }
if [ -z "$patch_text" ]; then
  echo "nothing to backport since export $(git rev-parse --short "$base")" >&2
  exit 0
fi

if ! printf '%s\n' "$patch_text" | patch -p1 -d "$dest" --forward --dry-run >&2; then
  echo "patch does not apply cleanly to $dest — nothing changed" >&2
  exit 1
fi
printf '%s\n' "$patch_text" | patch -p1 -d "$dest" --forward --no-backup-if-mismatch >&2
echo "backported edits since export $(git rev-parse --short "$base") to $dest" >&2

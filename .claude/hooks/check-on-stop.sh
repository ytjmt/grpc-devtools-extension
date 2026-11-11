#!/usr/bin/env bash
# Stop: with uncommitted changes, keeps Claude working until checks and unit/component tests pass.
set -uo pipefail
cd "$CLAUDE_PROJECT_DIR"
[ -n "$(git status --porcelain)" ] || exit 0
eval "$(.claude/hooks/path.sh)"
for cmd in "vp check" "vp test run"; do
  if ! out=$($cmd 2>&1); then
    printf '`%s` failed:\n%s\n' "$cmd" "$out" | tail -60 >&2
    exit 2
  fi
done

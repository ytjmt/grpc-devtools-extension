#!/usr/bin/env bash
set -euo pipefail
[ -n "${CLAUDE_ENV_FILE:-}" ] || exit 0
"$(dirname "$0")/path.sh" >> "$CLAUDE_ENV_FILE"

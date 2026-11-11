#!/usr/bin/env bash
# Prints `export PATH=...` with only this repository's tools prepended: the bin directories of the
# tools pinned in mise.toml, and node_modules/.bin. No other mise output (env vars, global or
# mise.local.toml tools) is passed on.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
bins=""
if command -v mise >/dev/null && command -v jq >/dev/null; then
  tools=$(cd "$root" && mise ls --local --current --json |
    jq -r --arg src "$root/mise.toml" 'to_entries[] | select(any(.value[]; .source.path == $src)) | .key')
  # shellcheck disable=SC2086 # one tool per word
  [ -n "$tools" ] && bins=$(cd "$root" && mise bin-paths $tools | paste -sd: -)
fi
# shellcheck disable=SC2016 # $PATH expands where the line is sourced
printf 'export PATH="%s%s/node_modules/.bin:$PATH"\n' "${bins:+$bins:}" "$root"

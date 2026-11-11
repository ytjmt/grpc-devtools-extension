#!/usr/bin/env bash
# PostToolUse: regenerates example/gen and the descriptor sets after a .proto edit.
set -uo pipefail
cd "$CLAUDE_PROJECT_DIR"
case "$(jq -r '.tool_input.file_path // empty')" in
  "$CLAUDE_PROJECT_DIR"/example/proto/*.proto) ;;
  *) exit 0 ;;
esac
eval "$(.claude/hooks/path.sh)"
if ! out=$(mise run example:gen 2>&1); then
  printf 'example:gen failed:\n%s\n' "$out" | tail -40 >&2
  exit 2
fi

@AGENTS.md

## Claude Code

The hooks in `.claude/settings.json` do three things:

- Put the tools pinned in `mise.toml` and `node_modules/.bin` on PATH.
- Run `example:gen` after a `.proto` edit.
- Block stopping while the working tree has changes and `vp check` or `vp test run` fails.

If the Stop hook fails for a reason outside your change, report it instead of retrying.

# grpc-devtools-extension

Chrome DevTools extension that decodes gRPC-Web and Connect traffic. The README covers features and commands.

## Setup

`mise install`, then `pnpm install`, which also installs Playwright's Chromium. Run tools through `vp` (Vite+). Do not use npm or npx.

## Verifying changes

Lint, type checks, and formatting run in `vp check`. CI runs every suite. Run these yourself when they apply:

- After changing panel UI or `styles.css`, run `vp run test:vrt` (needs Docker). Update screenshot baselines only with `vp run test:vrt -u`, and review the image diffs.
- After changing capture or DevTools wiring (`capture.ts`, `devtools.ts`, `manifest.json`), run `vp run test:e2e`.
- When decoder output changes on purpose, update `tests/unit/__snapshots__` with `vp test run -u` and review the diff.
- Re-record `tests/fixtures/*-calls.json` with `vp run fixtures:record` when the demo app changes. Do not edit those files by hand.

## Design

- Chrome APIs are reached only through `CaptureStore` and `SchemaBackend`, so tests swap in fakes from `tests/support/`.
- Core code reports user-facing text as `Text` (`msg(key)` or a server-sent literal). The panel renders it through the catalog in `extension/src/i18n/en.ts`.

## Dependencies and CI

- Packages come from Takumi Guard (`.npmrc`) and must be at least 3 days old (`minimumReleaseAge`). Do not bypass either.
- The Renovate workflow runs self-hosted Renovate daily (`renovate.json`) for npm packages, GitHub Actions, and the tools in `mise.toml`.
- Vite+ and Vitest move together: Renovate updates only vite-plus and runs `vp migrate` for the rest.
- Tool versions are pinned in `mise.toml`.
- A new `postUpgradeTasks` command must also match `RENOVATE_ALLOWED_COMMANDS` in the Renovate workflow.
- After editing `.github/`, run `gh-actions-lock` to update `actions.lock`.

## Releases

Run the Prepare release workflow (`/release` in Claude Code), then merge the PR it opens. CI on `main` publishes the release. Do not create tags or releases by hand.

## Commits

Write commit messages as an imperative subject line in English, followed by a body that explains why.

#!/usr/bin/env bash
# Publishes the build to GitHub Releases as v<package.json version>.
#
#   vp run release             # create and publish the release
#   vp run release --dry-run   # run every check and build, but only print the gh command
#   vp run release --draft     # other flags are passed to `gh release create`
#
# Bump "version" in package.json and push that commit to main first.
set -euo pipefail
cd "$(dirname "$0")/.."

fail() {
  echo "error: $*" >&2
  exit 1
}

DRY_RUN=false
GH_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    *) GH_ARGS+=("$arg") ;;
  esac
done

VERSION=$(node -p 'require("./package.json").version')
TAG="v${VERSION}"

# Release exactly what is on origin/main, once per version.
[ -z "$(git status --porcelain)" ] || fail "working tree is not clean"
[ "$(git branch --show-current)" = main ] || fail "releases are made from main"
git fetch --quiet --tags origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || fail "main differs from origin/main; push or pull first"
if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
  fail "tag ${TAG} already exists; bump the version in package.json"
fi
gh auth status >/dev/null 2>&1 || fail "gh is not authenticated; run: gh auth login"

vp check
vp run test
ASSET=$(scripts/package.sh)

# `${arr[@]+...}` keeps empty arrays safe under `set -u` on macOS's bash 3.2.
CMD=(gh release create "${TAG}" "${ASSET}" --target "$(git rev-parse HEAD)" --title "${TAG}" --generate-notes ${GH_ARGS[@]+"${GH_ARGS[@]}"})
if ${DRY_RUN}; then
  echo "dry run: ${CMD[*]}"
else
  "${CMD[@]}"
fi

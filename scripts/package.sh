#!/usr/bin/env bash
# Builds the extension and zips dist/ as release/grpc-devtools-extension-v<version>.zip.
# The zip has manifest.json at its root, as Chrome and the Chrome Web Store expect.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p 'require("./package.json").version')
ASSET="release/grpc-devtools-extension-v${VERSION}.zip"

vp run build >/dev/null
rm -rf release
mkdir release
(cd dist && zip -qr "../${ASSET}" .)
echo "${ASSET}"

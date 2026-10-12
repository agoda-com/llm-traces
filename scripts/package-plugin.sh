#!/usr/bin/env bash
# Packages dist/ into the zip layout the Grafana plugin catalog expects:
#   <plugin-id>-<version>.zip containing a single <plugin-id>/ directory.
# Writes <zip>.sha1 (required by the catalog submission form) and <zip>.sha256 next to the zip.
# Prints the zip file name on the last line of stdout.
#
# Usage: scripts/package-plugin.sh [output-dir]   (run from the repository root after `npm run build`)
set -euo pipefail

OUT_DIR="$(cd "${1:-.}" && pwd)"
PLUGIN_ID="$(node -p "require('./dist/plugin.json').id")"
VERSION="$(node -p "require('./dist/plugin.json').info.version")"
ZIP_NAME="${PLUGIN_ID}-${VERSION}.zip"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -R dist "${STAGE}/${PLUGIN_ID}"

rm -f "${OUT_DIR}/${ZIP_NAME}"
(cd "$STAGE" && zip -qr "${OUT_DIR}/${ZIP_NAME}" "${PLUGIN_ID}")

(cd "$OUT_DIR" && sha1sum "$ZIP_NAME" > "${ZIP_NAME}.sha1" && sha256sum "$ZIP_NAME" > "${ZIP_NAME}.sha256")

echo "$ZIP_NAME"

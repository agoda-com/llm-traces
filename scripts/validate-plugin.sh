#!/usr/bin/env bash
# Runs the Grafana plugin validator on a release zip and fails on any error-level finding.
# Warnings (for example "unsigned plugin" before the plugin is approved) never fail the run.
#
# Usage: scripts/validate-plugin.sh <plugin-zip>   (run from the repository root; needs network access)
set -euo pipefail

ZIP="$(cd "$(dirname "${1:?usage: scripts/validate-plugin.sh <plugin-zip>}")" && pwd)/$(basename "$1")"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

printf 'global:\n  enabled: true\n  jsonOutput: true\n' > "$WORK/validator.yaml"

# The validator exits non-zero when it reports errors; the JSON report is what decides the result.
npx --yes @grafana/plugin-validator@latest \
  -config "$WORK/validator.yaml" \
  -sourceCodeUri "file://$(pwd)" \
  "$ZIP" > "$WORK/report.json" || true

if ! jq -e '.id and (.["plugin-validator"] != null)' "$WORK/report.json" > /dev/null; then
  echo "::error::Plugin validator did not produce a report for ${ZIP}" >&2
  cat "$WORK/report.json" >&2
  exit 1
fi

jq -r '.["plugin-validator"] | to_entries[] | .key as $analyzer | .value[] | "\(.Severity)\t\($analyzer)/\(.Name)\t\(.Title) - \(.Detail)"' "$WORK/report.json"

ERRORS="$(jq -r '
  .["plugin-validator"] | to_entries[] | .key as $analyzer | .value[]
  | select(.Severity == "error")
  | "\($analyzer)/\(.Name): \(.Title) - \(.Detail)"' "$WORK/report.json")"

if [ -n "$ERRORS" ]; then
  echo "Plugin validator errors:" >&2
  echo "$ERRORS" >&2
  exit 1
fi
echo "Plugin validator: no errors."

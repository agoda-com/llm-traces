#!/usr/bin/env bash
# Runs the Grafana plugin validator on a release zip and fails on any error-level finding,
# except the findings that are expected until the plugin is registered and signed:
#   - org / missing-grafanacloud-account  (the Grafana Cloud account in the plugin ID is not registered yet)
#   - org / scan-incomplete               (follows from the unregistered account)
# Warnings (for example "unsigned plugin") never fail the run.
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

UNEXPECTED="$(jq -r '
  .["plugin-validator"] | to_entries[] | .key as $analyzer | .value[]
  | select(.Severity == "error")
  | select(($analyzer == "org" and (.Name == "missing-grafanacloud-account" or .Name == "scan-incomplete")) | not)
  | "\($analyzer)/\(.Name): \(.Title) - \(.Detail)"' "$WORK/report.json")"

if [ -n "$UNEXPECTED" ]; then
  echo "Unexpected plugin validator errors:" >&2
  echo "$UNEXPECTED" >&2
  exit 1
fi
echo "Plugin validator: no unexpected errors."

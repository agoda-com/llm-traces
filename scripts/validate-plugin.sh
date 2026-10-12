#!/usr/bin/env bash
# Runs Grafana's plugin validator on a release zip, with the plugin source, and fails on:
#   - any error-level finding, except `unsigned-plugin` (expected until Grafana signs the plugin);
#   - any `code-rules-*` finding, even a warning, because Grafana's plugin review requires them fixed.
#
# The validator runs from Grafana's Docker image because the code-rules analyzer needs semgrep,
# and the npm package silently skips that analyzer when semgrep is not installed.
# The script fails if the code-rules analyzer did not run.
#
# Usage: scripts/validate-plugin.sh <plugin-zip>   (run from the repository root; needs Docker)
# The source is the committed tree (HEAD), the same view Grafana's review gets from the repository.
set -euo pipefail

# Bump the tag and the digest together; the digest is the multi-arch index digest of the tag.
VALIDATOR_IMAGE="grafana/plugin-validator-cli:v0.49.14@sha256:8ad7eea7178d49a6f3b5778f17d1f33dc85caf4e0788ae7b8add785f5d442d0a"

ZIP="$(cd "$(dirname "${1:?usage: scripts/validate-plugin.sh <plugin-zip>}")" && pwd)/$(basename "$1")"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir "$WORK/source"
git archive HEAD | tar -x -C "$WORK/source"
# reportAll adds an "ok" entry per analyzer that ran, which is how the script checks that code-rules ran.
printf 'global:\n  enabled: true\n  jsonOutput: true\n  reportAll: true\n' > "$WORK/validator.yaml"

# The validator exits non-zero when it reports errors; the JSON report is what decides the result.
# The image is linux/amd64 only, so the platform is pinned for Apple Silicon hosts.
docker run --rm --platform linux/amd64 \
  -v "$ZIP:/plugin.zip:ro" \
  -v "$WORK/source:/source:ro" \
  -v "$WORK/validator.yaml:/validator.yaml:ro" \
  "$VALIDATOR_IMAGE" \
  -config /validator.yaml \
  -sourceCodeUri file:///source \
  /plugin.zip > "$WORK/report.json" 2> "$WORK/stderr.log" || true

if ! jq -e '.id and (.["plugin-validator"] != null)' "$WORK/report.json" > /dev/null 2>&1; then
  echo "::error::Plugin validator did not produce a report for ${ZIP}" >&2
  cat "$WORK/stderr.log" "$WORK/report.json" >&2
  exit 1
fi

if ! jq -e '.["plugin-validator"]["code-rules"] != null' "$WORK/report.json" > /dev/null; then
  echo "::error::The code-rules analyzer did not run, so semgrep findings were not checked" >&2
  cat "$WORK/stderr.log" >&2
  exit 1
fi

# Paths inside the container are /source/...; show them relative to the repository root.
jq -r '.["plugin-validator"] | to_entries[] | .key as $analyzer | .value[]
  | select(.Severity != "ok")
  | "\(.Severity)\t\($analyzer)/\(.Name)\t\(.Title) - \(.Detail)"' "$WORK/report.json" | sed 's#/source/##'

FAILURES="$(jq -r '
  .["plugin-validator"] | to_entries[] | .key as $analyzer | .value[]
  | select(
      (.Severity == "error" and .Name != "unsigned-plugin")
      or (.Severity != "ok" and (.Name | startswith("code-rules-"))))
  | "\(.Severity) \($analyzer)/\(.Name): \(.Title) - \(.Detail)"' "$WORK/report.json" | sed 's#/source/##')"

if [ -n "$FAILURES" ]; then
  echo "Plugin validator failures:" >&2
  echo "$FAILURES" >&2
  exit 1
fi
echo "Plugin validator: no errors and no code-rules findings."

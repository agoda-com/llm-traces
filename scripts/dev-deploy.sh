#!/bin/bash
# Build and hot-reload plugin into the running dev container
# Usage: ./scripts/dev-deploy.sh [container-name]
CONTAINER="${1:-llm-trace-dev-grafana-1}"
PLUGIN_DIR="/var/lib/grafana/plugins/agoda-llmtraces-app"

echo "Building plugin..."
npm run build || exit 1

echo "Copying to $CONTAINER..."
docker cp dist/. "$CONTAINER:$PLUGIN_DIR/"
docker cp provisioning/datasources "$CONTAINER:/etc/grafana/provisioning/datasources"

echo "Restarting Grafana..."
docker restart "$CONTAINER"

echo "Done! Plugin available at http://localhost:3000/a/agoda-llmtraces-app"

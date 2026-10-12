# LLM Traces — Grafana Plugin

[![CI](https://github.com/agoda-com/llm-traces/actions/workflows/ci.yml/badge.svg)](https://github.com/agoda-com/llm-traces/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://github.com/agoda-com/llm-traces/blob/main/LICENSE)

A Grafana app plugin for visualizing LLM (Large Language Model) traces stored in [Grafana Tempo](https://grafana.com/oss/tempo/).

Supports multiple span conventions out of the box:

- **OpenInference** (Phoenix, Traceloop, etc.)
- **OTel GenAI** (OpenTelemetry Semantic Conventions for GenAI)
- **Vertex AI** (GCP Vertex AI Agent Builder)

## Features

- Browse and search LLM traces via TraceQL
- Inspect input/output messages with Markdown rendering
- View tool calls with JSON payloads
- Multi-convention detection tabs (LLM / OpenInference / OTel GenAI)
- Token usage and estimated cost per span
- Trace timeline with span hierarchy visualization
- Resizable detail panels

<img src="https://raw.githubusercontent.com/agoda-com/llm-traces/main/docs/images/llm-traces-screenshot.png" alt="LLM Traces plugin showing trace list, span timeline with duration bars, and LLM span detail with input/output messages" width="100%">

## Requirements

| Component | Version |
|-----------|---------|
| Grafana | &ge; 11.3.0 |
| Node.js | &ge; 22.6 (for development) |
| A configured [Tempo](https://grafana.com/docs/tempo/latest/) datasource | |

## Installation

### From GitHub Releases (recommended)

1. Download the latest release zip from the [Releases](https://github.com/agoda-com/llm-traces/releases) page
2. Extract it into your Grafana plugins directory:
   ```bash
   unzip llm-traces-app-*.zip -d /var/lib/grafana/plugins/
   ```
3. Add the plugin to Grafana's allow list (required for unsigned community plugins):
   ```ini
   [plugins]
   allow_loading_unsigned_plugins = llm-traces-app
   ```
4. Restart Grafana

### Using Docker Compose

A single command starts Grafana with the plugin, a provisioned Tempo data source, and sample LLM traces.
Docker builds the plugin from source, so Node.js and a prior build are not needed:

```bash
docker compose up
```

The first start compiles the plugin inside Docker and takes a few minutes.
Open **http://localhost:3000** (anonymous admin access), select **LLM Traces** in the side menu, and wait about 20 seconds after startup for the sample traces to appear.
Tempo accepts OTLP at `localhost:4317` (gRPC) and `localhost:4318` (HTTP), so you can send your own traces too.
If a default host port is taken, set `GRAFANA_PORT`, `TEMPO_OTLP_HTTP_PORT` or `TEMPO_OTLP_GRPC_PORT`.
Stop the stack and delete its data with `docker compose down -v`.

> Requires Docker Compose v2.

### Using provisioning

To auto-enable the plugin (Grafana app plugins must be explicitly enabled):

```yaml
# /etc/grafana/provisioning/plugins/llm-traces.yaml
apiVersion: 1
apps:
  - type: llm-traces-app
    org_id: 1
    disabled: false
```

## Usage

1. Navigate to **LLM Traces** in the Grafana side menu
2. Select a Tempo datasource
3. Use the search bar or [TraceQL](https://grafana.com/docs/tempo/latest/traceql/) to find traces
4. Click a trace to see the full span hierarchy
5. Click an LLM span to inspect messages, parameters, and token usage

## Development

```bash
# Install dependencies (also sets up pre-commit hook via Husky)
npm install

# Build the plugin into dist/
npm run build

# Rebuild on every change
npm run dev

# Run all unit tests
npm test

# Run individual test files
node --experimental-strip-types tests/llmUtils.unit.test.ts
node --import ./tests/node-loader.mjs --experimental-strip-types tests/tempoClient.unit.test.ts
node --experimental-strip-types tests/costUtils.unit.test.ts
node --experimental-strip-types tests/prism-traceql.unit.test.ts

# Lint & typecheck
npm run typecheck
npm run lint
```

> **Note:** Node.js >= 22.6 is required for the `--experimental-strip-types` flag used by the test runner and build scripts.

See [CONTRIBUTING.md](https://github.com/agoda-com/llm-traces/blob/main/CONTRIBUTING.md) for detailed contribution guidelines.

## License

[Apache-2.0](https://github.com/agoda-com/llm-traces/blob/main/LICENSE)

Copyright 2026 Agoda Services Co., Ltd.

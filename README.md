# LLM Traces for Grafana

[![CI](https://github.com/agoda-com/llm-traces/actions/workflows/ci.yml/badge.svg)](https://github.com/agoda-com/llm-traces/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/package-json/v/agoda-com/llm-traces)](https://github.com/agoda-com/llm-traces/blob/main/CHANGELOG.md)
[![Grafana](https://img.shields.io/badge/Grafana-%E2%89%A5%2011.3-F46800?logo=grafana&logoColor=white)](https://grafana.com/)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://github.com/agoda-com/llm-traces/blob/main/LICENSE)

## Overview

LLM Traces is a Grafana app plugin that shows the LLM calls recorded in your [Grafana Tempo](https://grafana.com/oss/tempo/) traces.
You search for traces, open one, and read what was sent to the model and what came back.
Messages, tool definitions, tool calls and tool results are laid out in order, next to the span timeline, token counts and estimated cost.

The plugin reads standard trace data from an existing Tempo data source.
It does not need an extra backend or its own configuration.

<img src="https://raw.githubusercontent.com/agoda-com/llm-traces/main/docs/images/llm-traces-screenshot.png" alt="LLM Traces showing the trace list, the span timeline and an LLM span with its messages, a tool call card and a tool result card" width="100%">

## Requirements

| Component | Version |
|-----------|---------|
| Grafana | 11.3 or newer (end-to-end tested on 11.3, 12.0, 12.4 and 13.1) |
| Data source | A [Tempo](https://grafana.com/docs/tempo/latest/) data source with [TraceQL](https://grafana.com/docs/tempo/latest/traceql/) search (the sample environment uses Tempo 2.7.2) |

The plugin recognises LLM spans written with these conventions:

- **OpenInference** (for example Arize Phoenix and Traceloop instrumentation)
- **OpenTelemetry GenAI** semantic conventions (`gen_ai.*`)
- **Vertex AI** (GCP Vertex AI Agent Builder)

Known limitation: the menu entry uses the `ai-sparkle` icon, which exists only in Grafana 12.0 and newer.
On Grafana 11.x the entry appears without an icon; the plugin works the same otherwise.

## Getting started

### Install from the Grafana plugin catalog

Once the plugin is published in the catalog, install it from the Grafana UI (**Administration > Plugins and data > Plugins**, search for "LLM Traces") or with the CLI:

```bash
grafana cli plugins install agoda-llmtraces-app
```

Restart Grafana after a CLI install.

### Install manually from a release zip

1. Download `agoda-llmtraces-app-<version>.zip` from the [Releases](https://github.com/agoda-com/llm-traces/releases) page.
2. Extract it into the Grafana plugins directory:
   ```bash
   unzip agoda-llmtraces-app-*.zip -d /var/lib/grafana/plugins/
   ```
3. While the zip is unsigned, add the plugin to the allow list in `grafana.ini`:
   ```ini
   [plugins]
   allow_loading_unsigned_plugins = agoda-llmtraces-app
   ```
4. Restart Grafana.

### Enable the plugin

Grafana app plugins must be enabled once per organization.
Open **Administration > Plugins and data > Plugins > LLM Traces** and click **Enable**, or provision it:

```yaml
# /etc/grafana/provisioning/plugins/llm-traces.yaml
apiVersion: 1
apps:
  - type: agoda-llmtraces-app
    org_id: 1
    disabled: false
```

### Configuration

The plugin has no settings of its own.
It lists every Tempo data source that exists in the organization and uses the first one by default.
Pick another one in the data source selector at the top of the page.
If no Tempo data source exists, the page shows a message asking you to add one (**Connections > Data sources > Add data source > Tempo**).

The role required to open the page is Viewer.
Tempo itself must have trace search enabled, because the plugin finds traces with TraceQL queries.

### Use it

1. Select **LLM Traces** in the side menu.
2. Choose a Tempo data source and a time range.
3. Use the **Search** tab to filter by service or span name, or the **TraceQL** tab to write your own [TraceQL](https://grafana.com/docs/tempo/latest/traceql/) query. Then click **Search**.
4. Click a trace to see its span hierarchy.
5. Click an LLM span to read its messages, tool calls, parameters and token usage.

A trace can be opened directly with a link to `/a/agoda-llmtraces-app?llt-traceId=<trace id>`.

## Features

- Search LLM traces with TraceQL and filter by LLM-specific attributes.
- Read input and output messages with Markdown rendering. Text, reasoning, tool call and tool result parts keep their original order.
- Browse the tool catalog sent with a request. It is collapsed by default, searchable, and each tool expands to its parameters and raw JSON schema.
- Follow tool calls and results as linked cards with copy buttons. Large results are shortened and can be shown in full.
- See token usage and estimated cost per span, based on a built-in price list.
- Explore the span hierarchy in a timeline with collapse and expand controls.
- Switch between the LLM, OpenInference and OTel GenAI views of the same span.
- Resize the trace list and the detail panels. The layout stays readable on narrow screens.

<img src="https://raw.githubusercontent.com/agoda-com/llm-traces/main/docs/images/llm-traces-tool-catalog.png" alt="LLM span detail showing the model output, the searchable tool catalog and an expanded tool definition" width="100%">

## Try it locally

You can run Grafana, Tempo and the plugin with sample traces using Docker Compose.
You do not need Node.js, and you do not need to build anything first.

```bash
git clone https://github.com/agoda-com/llm-traces.git
cd llm-traces
docker compose up
```

The first start compiles the plugin inside Docker and takes a few minutes.
Then:

1. Open **http://localhost:3000**. Anonymous access with the Admin role is enabled and the Tempo data source is already provisioned.
2. Select **LLM Traces** in the side menu. The plugin is already enabled.
3. Wait about 20 seconds after startup. A seeding container sends four sample traces to Tempo, and Tempo needs a moment to make them searchable.
4. Click **Search** in the toolbar at the top right. The trace list fills and the newest trace opens. If the list is empty, wait a few seconds and click **Search** again.
5. Open `support_agent_run` (OpenInference agent with a guardrail check, two LLM calls and a tool call). Click the second span named `llm claude-sonnet-4-5` to see the tool call card, the tool result card and the output. Expand **Available Tools** to search the tool catalog and open a tool definition. Click the `input_guardrail` span to see a guardrail check.
6. Open `plan_city_break` (OTel GenAI conventions with structured messages and a tool call) and click its `chat gpt-4o` span.
7. Open `customer_query_chain` and `generate_summary` for plain chat messages, parameters, token counts and estimated cost.

Tempo also accepts your own traces on `localhost:4317` (OTLP gRPC) and `localhost:4318` (OTLP HTTP).
If a default host port is taken, set `GRAFANA_PORT`, `TEMPO_OTLP_HTTP_PORT` or `TEMPO_OTLP_GRPC_PORT`.
Stop the stack and delete its data with `docker compose down -v`.
Docker Compose v2 is required.

## Development

```bash
# Install dependencies (also sets up the pre-commit hook via Husky)
npm install

# Build the plugin into dist/
npm run build

# Rebuild on every change
npm run dev

# Typecheck, lint and unit tests
npm run typecheck
npm run lint
npm test

# End-to-end tests against a running Grafana with the plugin installed
npm run e2e
```

Node.js 22.6 or newer is required, because the test runner and the build scripts use `--experimental-strip-types`.
See [CONTRIBUTING.md](https://github.com/agoda-com/llm-traces/blob/main/CONTRIBUTING.md) for the full workflow.

## Contributing

Bug reports and feature requests go to [GitHub Issues](https://github.com/agoda-com/llm-traces/issues).
Pull requests are welcome; read [CONTRIBUTING.md](https://github.com/agoda-com/llm-traces/blob/main/CONTRIBUTING.md) first.
Security issues are handled as described in [SECURITY.md](https://github.com/agoda-com/llm-traces/blob/main/SECURITY.md).

## License

[Apache-2.0](https://github.com/agoda-com/llm-traces/blob/main/LICENSE)

Copyright 2026 Agoda Services Co., Ltd.

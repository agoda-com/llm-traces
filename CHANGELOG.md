# Changelog

## 0.1.1 - 2026-10-12

### Breaking Changes
- The plugin ID changed from `llm-traces-app` to `agoda-llmtraces-app` so that it starts with the Grafana Cloud organization slug (`agoda`), as the plugin catalog requires. Grafana treats this as a different plugin. Remove the old `llm-traces-app` install, install `agoda-llmtraces-app`, and enable it again.
- Update provisioning files (`type: agoda-llmtraces-app`), `allow_loading_unsigned_plugins`, bookmarks and links. The page URL changed from `/a/llm-traces-app` to `/a/agoda-llmtraces-app`.
- The minimum supported Grafana version is now 11.3.0 (was 11.1.0). On Grafana 11.1 and 11.2 the page scrolls inside the main container instead of the window, which the plugin layout does not support.

### Features
- Message parts from OpenInference, OTel GenAI and Vertex AI spans are normalized and shown in their original order: text, reasoning, tool calls and tool results.
- A collapsed, searchable tool catalog lists the tools sent with a request. Each tool expands to its parameters and raw schema.
- Tool calls and results are shown as linked cards with copy buttons. Large results are shortened and can be expanded.
- Short arrays of simple values in tool arguments are shown on one line.
- LLM attributes that are already shown in the detail view are collapsed into a single expandable group.
- A trace opened from a deep link loads directly, independent of the broad trace search.
- Grafana 13 (React 19) is supported. The same build also runs on Grafana 12 (React 18).
- `docker compose up` starts Grafana with the plugin, Tempo, and sample LLM traces for reviewers and contributors. The samples include plain chats, an agent run with a tool call and a guardrail check, and an OTel GenAI span.

### Bug Fixes
- Traces load faster: the trace request uses the selected time range (and retries without it on a 404), and the `gpt-tokenizer` dependency was replaced by a lightweight token estimate.
- Trace and span details stay readable on compact layouts: long span names are truncated instead of overlapping the duration, and the toolbar wraps instead of clipping.
- Search tab Status, Kind and Duration filters produce valid TraceQL (`status=error`, `duration>5s`) instead of quoted values that Tempo rejected.
- Traces shorter than 1 ms show `<1ms` in the trace list instead of `NaNs`.
- Opening a trace no longer scrolls the page and hides the toolbar.
- Trace IDs whose leading zeros were trimmed (16 to 32 hex characters) open the trace when pasted into the query box.
- OTel GenAI `thinking` message parts render as reasoning instead of an unknown part.
- The release zip now contains NOTICE, README.md and source maps, and ships with `.sha1` and `.sha256` checksums.

## 0.0.1 - 2026-04-06
- Initial open-source release
- LLM trace visualization for OpenInference, OTel GenAI, and Vertex AI spans
- TraceQL query builder with LLM-specific filters
- Cost calculation based on token usage
- Resizable trace detail panels

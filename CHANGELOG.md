# Changelog

## 0.1.3 - 2026-10-13

### Features
- The trace tree shows which agent owns each span. Each agent gets a colour, shown as a rail on the left edge of its spans; traces with more than five agents reuse the colours. Agent spans show the agent name in bold, followed by "from X" when another agent handed the work over, and the other spans an agent runs carry a chip with its name.
- Kind icons replace the LLM, TOOL and AGENT text badges. Hover an icon to see the kind.
- The span detail header shows the span kind, the agent that owns the span or handed it off, and the agent description when the trace provides one.
- Agent names are read from `gen_ai.agent.name`, `agent.name`, or the span name of `invoke_agent <name>` and `create_agent <name>` spans.
- Deep and large traces behave like Grafana's trace view. Every level gets its own indent guide with no depth cap, and hovering a guide highlights the line from an ancestor through all of its descendants. When the guides do not fit, the levels nearest the name fold into a "+N" marker, so the span name, duration and timeline stay visible.
- The name column can be resized by dragging (20% to 85% of the row), and the width is remembered in the browser.
- Expand +1 and Collapse +1 buttons open or close one level of the tree. As in Grafana, `o` and `p` do the same from the keyboard, and `[` and `]` expand or collapse everything. Selecting a span opens its collapsed ancestors.
- Only the rows near the viewport are rendered, so a 30,000-span trace opens with about 1,800 DOM nodes in the span list.

### Bug Fixes
- Span chains thousands of levels deep no longer overflow the call stack.
- The service name and the agent labels in a span row are shown whole or hidden when the row is narrow, never cut into fragments. The service name now follows the span name, so names line up after the kind icon.

## 0.1.2 - 2026-10-13

### Bug Fixes
- Google ADK (`gcp.vertex.agent`) spans render their conversation: the system instruction, user, model and context messages, `functionCall` and `functionResponse` parts as tool call and tool result cards, the tool catalog from `config.tools`, and the response from ADK's `content` and `usageMetadata` format. Both ADK Java and ADK Python attribute names are supported.
- `call_llm` spans are shown as LLM spans, and ADK `execute_tool` spans show their arguments and response as tool cards.
- ADK spans without captured content (`ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS=false`) or with payloads ADK could not serialize show an explicit notice instead of looking empty.
- JSON-valued attributes are parsed before unicode escapes are decoded for display. Previously some valid request and response payloads failed to parse and their messages silently disappeared.
- The Share button builds its link with Grafana's `locationService` and `appUrl` instead of reading `window.location`, which also keeps links correct when Grafana is served from a sub-path.

### Maintenance
- CI runs the full Grafana plugin validator, including its code rules, and fails on any code-rule finding.

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

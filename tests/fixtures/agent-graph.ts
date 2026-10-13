// Synthetic traces for the agent graph: one for each shape the graph has to handle. Every name is made up.
//
//   ADK_GRAPH_TRACE            a coordinator with agents used as tools, guardrails, nested same-model spans
//   DECLARED_GRAPH_TRACE       graph.node.id / graph.node.parent_id where the declared parent differs from the nesting
//   TOOL_LOOP_TRACE            one agent that calls the same tool many times
//   REPEATED_AGENT_TRACE       an agent that runs three times, and model calls outside every agent
//   NO_AI_TRACE                HTTP spans only

import { buildTrace } from './conventions';
import type { AttrValue, FixtureSpan } from './conventions';

const BASE_MS = 1741900000000;
const nano = (offsetMs: number) => String(BigInt(BASE_MS + offsetMs) * 1000000n);

interface TreeNode {
  /** Lets a test refer to the span id. */
  key?: string;
  name: string;
  attributes: Record<string, AttrValue>;
  children: TreeNode[];
  failed?: boolean;
}

const n = (name: string, attributes: Record<string, AttrValue>, children: TreeNode[] = [], extra: Pick<TreeNode, 'key' | 'failed'> = {}): TreeNode =>
  ({ name, attributes, children, ...extra });

const LEAF_MS = 100;
const PAD_MS = 20;

/**
 * Flattens a tree into fixture spans with ids "<prefix><index>" in trace order. Leaves last 100 ms, children run one
 * after another, and a parent covers its children with a little padding on both sides.
 */
function flatten(prefix: string, root: TreeNode): { spans: FixtureSpan[]; ids: Record<string, string> } {
  const spans: FixtureSpan[] = [];
  const ids: Record<string, string> = {};
  let cursor = 0;
  let counter = 0;
  const visit = (node: TreeNode, parentSpanId: string | undefined): void => {
    const spanId = `${prefix}${String(++counter).padStart(4, '0')}`;
    if (node.key) {
      ids[node.key] = spanId;
    }
    const startMs = cursor;
    const span: FixtureSpan = { spanId, parentSpanId, name: node.name, startMs, endMs: startMs, attributes: node.attributes };
    spans.push(span);
    if (node.children.length === 0) {
      cursor += LEAF_MS;
    } else {
      cursor += PAD_MS;
      node.children.forEach((child) => visit(child, spanId));
      cursor += PAD_MS;
    }
    span.endMs = cursor;
    if (node.failed) {
      span.attributes = { ...span.attributes, 'otel.status_code': 'ERROR' };
    }
  };
  visit(root, undefined);
  return { spans, ids };
}

const searchResponse = (traceId: string, rootName: string, durationMs: number) => ({
  traces: [{ traceID: traceId, rootServiceName: 'graph-service', rootTraceName: rootName, startTimeUnixNano: nano(0), durationMs, spanSets: [] }],
});

export interface GraphFixture {
  traceId: string;
  searchResponse: ReturnType<typeof searchResponse>;
  traceResponse: ReturnType<typeof buildTrace>;
  ids: Record<string, string>;
}

function fixture(traceId: string, prefix: string, rootName: string, root: TreeNode): GraphFixture {
  const { spans, ids } = flatten(prefix, root);
  return {
    traceId,
    searchResponse: searchResponse(traceId, rootName, spans[0].endMs),
    traceResponse: buildTrace(traceId, { name: 'example.agents', version: '1.0.0' }, spans, 'graph-service'),
    ids,
  };
}

const agentSpan = (name: string) => ({ 'gen_ai.operation.name': 'invoke_agent', 'gen_ai.agent.name': name });
const toolSpan = (name: string, extra: Record<string, AttrValue> = {}) => ({ 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': name, ...extra });
const modelCall = (model: string) => ({ 'gen_ai.operation.name': 'call_llm', 'gen_ai.request.model': model });
const generate = (model: string) => ({ 'openinference.span.kind': 'LLM', 'llm.model_name': model });
const chat = (model: string) => ({ 'gen_ai.operation.name': 'chat', 'gen_ai.request.model': model });
const guardrail = { 'openinference.span.kind': 'GUARDRAIL' };
const http = { 'http.route': '/check' };

// ---- (a) ADK-like: a coordinator whose sub-agents are tools ----

export const ADK_GRAPH_TRACE_ID = 'ad0000000000000000000000000000a1';

const agentAsTool = (agent: string, inner: TreeNode[], failed = false): TreeNode =>
  n(`execute_tool ${agent}`, toolSpan(agent), [
    n('invocation', { 'openinference.span.kind': 'CHAIN' }, [
      n(`invoke_agent ${agent}`, agentSpan(agent), [
        n('call_llm', modelCall('model-beta'), [n('generate', generate('model-beta'))]),
        ...inner,
      ]),
    ]),
  ], failed ? { failed: true } : {});

export const ADK_GRAPH = fixture(ADK_GRAPH_TRACE_ID, 'ad', 'trip_request', n('invocation', { 'openinference.span.kind': 'CHAIN' }, [
  n('invoke_agent trip_coordinator', agentSpan('trip_coordinator'), [
    n('call_llm', modelCall('model-alpha'), [
      n('generate', generate('model-alpha')),
      n('POST /safety', http, [n('guardrail input_check', guardrail), n('guardrail pii_check', guardrail)]),
    ]),
    agentAsTool('fare_agent', [
      n('execute_tool lookup_fares', toolSpan('lookup_fares'), [], { key: 'fareLookup1' }),
      n('execute_tool lookup_fares', toolSpan('lookup_fares'), [], { key: 'fareLookup2', failed: true }),
    ]),
    n('execute_tool (merged tools)', toolSpan('(merged tools)')),
    agentAsTool('room_agent', [n('execute_tool lookup_rooms', toolSpan('lookup_rooms'), [], { key: 'roomLookup' })]),
    agentAsTool('fare_agent', [n('execute_tool lookup_fares', toolSpan('lookup_fares'), [], { key: 'fareLookup3' })]),
    n('call_llm', modelCall('model-alpha'), [n('generate', generate('model-alpha')), n('POST /safety', http, [n('guardrail output_check', guardrail)])]),
    n('execute_tool format_summary', toolSpan('format_summary'), [], { key: 'summary' }),
  ], { key: 'coordinator' }),
  n('write_audit_log', { 'http.route': '/audit' }, [], { key: 'audit' }),
]));

// ---- (b) OpenAI-Agents-like: declared parent differs from the nesting ----

export const DECLARED_GRAPH_TRACE_ID = 'de0000000000000000000000000000b2';

const graphNode = (id: string, parentId?: string, name?: string): Record<string, AttrValue> => ({
  'openinference.span.kind': 'AGENT',
  'graph.node.id': id,
  ...(parentId ? { 'graph.node.parent_id': parentId } : {}),
  ...(name ? { 'graph.node.name': name } : {}),
});
const oiLlm = (model: string) => ({ 'openinference.span.kind': 'LLM', 'llm.model_name': model });
const oiTool = (name: string) => ({ 'openinference.span.kind': 'TOOL', 'tool.name': name });

// intake and billing_desk are both declared as children of steward, but billing_desk runs inside the intake span.
export const DECLARED_GRAPH = fixture(DECLARED_GRAPH_TRACE_ID, 'de', 'support_request', n('workflow', { 'openinference.span.kind': 'CHAIN' }, [
  n('steward', graphNode('steward'), [
    n('chat', oiLlm('model-alpha')),
    n('intake', graphNode('intake', 'steward'), [
      n('chat', oiLlm('model-beta')),
      n('billing_desk', graphNode('billing_desk', 'steward', 'Billing desk'), [
        n('chat', oiLlm('model-beta')),
        n('refund_lookup', oiTool('refund_lookup'), [], { key: 'refundLookup' }),
      ], { key: 'billingDesk' }),
    ], { key: 'intake' }),
    n('chat', oiLlm('model-alpha')),
  ], { key: 'steward' }),
]));

// ---- (c) a long tool loop ----

export const TOOL_LOOP_TRACE_ID = 'e10000000000000000000000000000c3';

export const TOOL_LOOP_CALLS = 14;

export const TOOL_LOOP = fixture(TOOL_LOOP_TRACE_ID, 'lp', 'research_request', n('run_research', { 'openinference.span.kind': 'CHAIN' }, [
  n('invoke_agent researcher', agentSpan('researcher'), [
    ...Array.from({ length: TOOL_LOOP_CALLS }, (_, i) => [
      n('chat model-alpha', chat('model-alpha')),
      n('execute_tool fetch_page', toolSpan('fetch_page', { 'step.label': `fetch-${i + 1}` }), [], { failed: i === 6 }),
    ]).flat(),
    ...Array.from({ length: 3 }, () => n('execute_tool summarize_text', toolSpan('summarize_text'))),
    n('chat model-alpha', chat('model-alpha')),
  ], { key: 'researcher' }),
]));

// ---- (d) Pydantic-AI-like: a repeated agent, model calls outside any agent ----

export const REPEATED_AGENT_TRACE_ID = 'f20000000000000000000000000000d4';

export const REPEATED_AGENT = fixture(REPEATED_AGENT_TRACE_ID, 'rp', 'joke_request', n('handle_request', http, [
  n('chat model-gamma', chat('model-gamma'), [], { key: 'plannerCall' }),
  ...Array.from({ length: 3 }, (_, i) => n('agent run', { ...agentSpan('joke_writer'), 'step.label': `run-${i + 1}` }, [
    n('chat model-alpha', chat('model-alpha')),
    n('running tool: pick_topic', toolSpan('pick_topic')),
    n('chat model-alpha', chat('model-alpha')),
  ])),
  n('chat model-gamma', chat('model-gamma')),
  n('generation', { 'openinference.span.kind': 'LLM' }),
]));

// ---- no AI spans ----

export const NO_AI_TRACE_ID = 'a00000000000000000000000000000e5';

export const NO_AI = fixture(NO_AI_TRACE_ID, 'na', 'health_check', n('GET /health', { 'http.route': '/health' }, [
  n('SELECT status', { 'db.system': 'example-db' }),
]));

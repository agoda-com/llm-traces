// Unit tests for agentGraph.ts (graph model and layout)
// Run with: node --experimental-strip-types tests/agentGraph.unit.test.ts

import { buildAgentGraph, getAgentGraph, getNodeClickTarget, indexGraphSpans, START_NODE_ID } from '../src/utils/agentGraph.ts';
import type { AgentGraph } from '../src/utils/agentGraph.ts';
import { clampZoom, getAnchor, getAnchoredScroll, getDefaultScale, getFitScale, getInitialScroll, getGraphInView, getRevealScroll, getWheelZoomScale, getZoomRange, layoutAgentGraph, MAX_ROWS, MAX_ZOOM, normalizeWheelDelta, placeAgentGraph, READABLE_SCALE } from '../src/utils/agentGraphLayout.ts';
import type { PluginSpan } from '../src/utils/tempoClient.ts';

let passed = 0;
let failed = 0;

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`  FAIL: ${message} - expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed++;
  } else {
    console.log(`  pass: ${message}`);
    passed++;
  }
}

function describe(name: string, fn: () => void): void {
  console.log(`\n=== ${name} ===`);
  fn();
}

let counter = 0;
function makeSpan(
  parent: PluginSpan | null,
  operationName: string,
  attrs: Record<string, unknown> = {},
  extra: Partial<PluginSpan> = {}
): PluginSpan {
  const span: PluginSpan = {
    traceId: 't',
    spanId: `s${++counter}`,
    parentSpanId: parent ? parent.spanId : null,
    operationName,
    serviceName: 'svc',
    serviceAttributes: [],
    startTimeMs: counter * 10,
    durationMs: 5,
    tags: Object.entries(attrs).map(([key, value]) => ({ key, value: value as string })),
    logs: [],
    children: [],
    depth: parent ? parent.depth + 1 : 0,
    ...extra,
  };
  parent?.children.push(span);
  return span;
}

function edgeOf(graph: AgentGraph, from: string, to: string) {
  return graph.edges.find((e) => e.from === from && e.to === to);
}

function nodeIds(graph: AgentGraph): string[] {
  return graph.nodes.map((n) => n.id).sort();
}

describe('inference from nesting', () => {
  // invocation (chain) > coordinator agent > LLM call (wraps a model call, an HTTP guardrail, tools)
  const chain = makeSpan(null, 'invocation', { 'openinference.span.kind': 'CHAIN' });
  const coordinator = makeSpan(chain, 'invoke_agent coord', { 'gen_ai.operation.name': 'invoke_agent', 'gen_ai.agent.name': 'coord' });
  const llm = makeSpan(coordinator, 'call_llm', { 'gen_ai.operation.name': 'call_llm', 'gen_ai.request.model': 'model-a' });
  makeSpan(llm, 'generate', { 'openinference.span.kind': 'LLM', 'llm.model_name': 'model-a' });
  const http = makeSpan(llm, 'POST /check');
  makeSpan(http, 'guardrail g1', { 'openinference.span.kind': 'GUARDRAIL' });
  // A second model, called through a proxy next to the guardrail: a leaf of the agent, not of the first model.
  makeSpan(makeSpan(llm, 'POST /proxy'), 'proxy_request', { 'openinference.span.kind': 'LLM', 'gen_ai.request.model': 'model-judge' });
  makeSpan(llm, 'execute_tool helper', { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': 'helper' });
  makeSpan(llm, 'execute_tool (merged)', { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': '(merged tools)' });
  // An agent used as a tool: execute_tool sub > invocation > invoke_agent sub, called twice, one call fails.
  for (let i = 0; i < 2; i++) {
    const tool = makeSpan(llm, 'execute_tool sub', { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': 'sub' });
    const wrapper = makeSpan(tool, 'invocation', { 'openinference.span.kind': 'CHAIN' });
    const sub = makeSpan(wrapper, 'invoke_agent sub', { 'gen_ai.operation.name': 'invoke_agent', 'gen_ai.agent.name': 'sub' });
    const subLlm = makeSpan(sub, 'call_llm', { 'gen_ai.operation.name': 'call_llm', 'gen_ai.request.model': 'model-b' });
    const search = makeSpan(subLlm, 'execute_tool search', { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': 'search' }, i === 1 ? { statusCode: 'ERROR' } : {});
    // Whatever runs inside a tool stays under the tool.
    makeSpan(makeSpan(search, 'GET /embed'), 'embeddings', { 'gen_ai.operation.name': 'embeddings', 'gen_ai.request.model': 'model-e' });
  }

  const graph = buildAgentGraph([chain]);

  assertEquals(graph.source, 'inferred', 'source is inferred');
  assertEquals(nodeIds(graph), [
    START_NODE_ID, 'agent:coord', 'agent:sub', 'embedding::model-e', 'guardrails:agent:coord', 'llm:coord:model-a', 'llm:coord:model-judge',
    'llm:sub:model-b', 'tool:helper', 'tool:search',
  ].sort(), 'one node per agent, tool and model, one Guardrails node; wrappers, HTTP, merged tools and the model call under call_llm are not nodes');
  const edges = graph.edges.map((e) => `${e.from}>${e.to}`).sort();
  assertEquals(edges, [
    `${START_NODE_ID}>agent:coord`,
    'agent:coord>agent:sub',
    'agent:coord>guardrails:agent:coord',
    'agent:coord>llm:coord:model-a',
    'agent:coord>llm:coord:model-judge',
    'agent:coord>tool:helper',
    'agent:sub>llm:sub:model-b',
    'agent:sub>tool:search',
    'tool:search>embedding::model-e',
  ].sort(), 'tools, sub-agents and model calls hang off their agent; the embedding hangs off its tool');
  assertEquals(edgeOf(graph, 'agent:coord', 'llm:coord:model-a')?.count, 1, 'the model call nested in call_llm is absorbed, not counted twice');
  assertEquals(edgeOf(graph, 'agent:coord', 'agent:sub')?.count, 2, "an agent used as a tool takes the tool's place and keeps the call count");
  assertEquals(edgeOf(graph, 'agent:sub', 'llm:sub:model-b')?.count, 2, 'each sub-agent run has its own model call');
  assertEquals(edgeOf(graph, 'agent:sub', 'tool:search')?.errorCount, 1, 'the failed tool call is counted on the edge');
  assertEquals(graph.nodes.find((n) => n.id === 'tool:search')?.errorCount, 1, 'and on the node');
  assertEquals(graph.nodes.find((n) => n.id === 'agent:sub')?.calls.length, 2, 'node call count');
  assertEquals(graph.nodes.find((n) => n.id === 'agent:sub')?.totalMs, 10, 'node total duration');
  assertEquals(graph.nodes.find((n) => n.id === 'agent:coord')?.colorIndex, 0, 'agent nodes carry the agent colour index');
  assertEquals(graph.nodes.find((n) => n.id === 'agent:sub')?.colorIndex, 1, 'in order of first appearance');
  assertEquals(graph.nodes.find((n) => n.id === 'tool:helper')?.calls[0][0], llm.children.find((c) => c.operationName === 'execute_tool helper')?.spanId, 'node opens its first span');
});

describe('guardrail grouping', () => {
  const agentA = makeSpan(null, 'run a', { 'openinference.span.kind': 'AGENT', 'agent.name': 'a' });
  const agentB = makeSpan(null, 'run b', { 'openinference.span.kind': 'AGENT', 'agent.name': 'b' });
  const first = makeSpan(agentA, 'guardrail alpha', { 'openinference.span.kind': 'GUARDRAIL' }, { durationMs: 7 });
  makeSpan(agentA, 'guardrail beta', { 'openinference.span.kind': 'GUARDRAIL' }, { durationMs: 3 });
  makeSpan(agentA, 'guardrail alpha', { 'openinference.span.kind': 'GUARDRAIL' }, { statusCode: 'ERROR', durationMs: 2 });
  makeSpan(agentB, 'guardrail alpha', { 'openinference.span.kind': 'GUARDRAIL' });

  const graph = buildAgentGraph([agentA, agentB]);
  const group = graph.nodes.find((n) => n.id === 'guardrails:agent:a');

  assertEquals(nodeIds(graph).filter((id) => id.startsWith('guardrails:')), ['guardrails:agent:a', 'guardrails:agent:b'], 'one Guardrails node per owning node');
  assertEquals(group?.label, 'Guardrails', 'the node is called Guardrails');
  assertEquals(group?.kind, 'GUARDRAIL', 'it keeps the guardrail kind for the icon');
  assertEquals(group?.calls.length, 3, 'it counts every guardrail span');
  assertEquals(group?.totalMs, 12, 'it sums their durations');
  assertEquals(group?.errorCount, 1, 'and their failures');
  assertEquals(group?.breakdown, [{ label: 'alpha', count: 2 }, { label: 'beta', count: 1 }], 'it lists each guardrail name with its count');
  assertEquals(group?.calls[0][0], first.spanId, 'a click opens the first guardrail span');
  assertEquals(edgeOf(graph, 'agent:a', 'guardrails:agent:a')?.count, 3, 'the edge counts the guardrail calls');
});

describe('inference edge cases', () => {
  assertEquals(buildAgentGraph([]).nodes.map((n) => n.id), [START_NODE_ID], 'an empty trace has only the Start node');

  const http = makeSpan(null, 'GET /health');
  assertEquals(buildAgentGraph([http]).edges.length, 0, 'a trace without AI spans has no edges');

  const root = makeSpan(null, 'run', { 'openinference.span.kind': 'AGENT', 'agent.name': 'a' });
  const other = makeSpan(null, 'run b', { 'openinference.span.kind': 'AGENT', 'agent.name': 'b' });
  const graph = buildAgentGraph([root, other]);
  assertEquals(graph.edges.map((e) => `${e.from}>${e.to}`), [`${START_NODE_ID}>agent:a`, `${START_NODE_ID}>agent:b`], 'every root node hangs off Start');
});

describe('OpenInference graph.node attributes', () => {
  // The workflow span has no AI kind. The graph.node spans are agent nodes whatever their kind.
  const root = makeSpan(null, 'workflow');
  const plan = makeSpan(root, 'plan', { 'graph.node.id': 'planner', 'graph.node.name': 'Planner' });
  const act = makeSpan(root, 'act', { 'graph.node.id': 'executor', 'graph.node.parent_id': 'planner' });
  makeSpan(root, 'act again', { 'graph.node.id': 'executor', 'graph.node.parent_id': 'planner' });
  makeSpan(root, 'orphan', { 'graph.node.id': 'lost', 'graph.node.parent_id': 'never-seen' });
  makeSpan(root, 'write', { 'graph.node.id': 'agent:writer', 'graph.node.parent_id': 'planner' });
  // Without parent_id the nearest graph node above in the span tree is the caller.
  const review = makeSpan(act, 'review', { 'graph.node.id': 'reviewer' });
  // Other AI spans are inferred and attach to the nearest node above them.
  const search = makeSpan(act, 'execute_tool search', { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': 'search' });
  makeSpan(plan, 'chat', { 'openinference.span.kind': 'LLM', 'gen_ai.request.model': 'm1' });
  makeSpan(makeSpan(plan, 'POST /check'), 'guardrail g1', { 'openinference.span.kind': 'GUARDRAIL' });
  makeSpan(review, 'chat', { 'openinference.span.kind': 'LLM', 'gen_ai.request.model': 'm2' });
  // Not under any graph node: hangs off Start.
  makeSpan(root, 'execute_tool lookup', { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': 'lookup' });

  const graph = buildAgentGraph([root]);
  assertEquals(graph.source, 'graph-attributes', 'source is graph attributes');
  assertEquals(nodeIds(graph), [
    START_NODE_ID, 'agent:writer', 'executor', 'guardrails:planner', 'llm:Planner:m1', 'llm:reviewer:m2', 'lost', 'planner', 'reviewer', 'tool:lookup', 'tool:search',
  ].sort(), 'graph.node.id defines the agent nodes, the other AI spans add their own nodes');
  assertEquals(graph.nodes.find((n) => n.id === 'planner')?.label, 'Planner', 'graph.node.name is the label');
  assertEquals(graph.nodes.find((n) => n.id === 'executor')?.label, 'executor', 'the id is the label without a name');
  assertEquals(graph.nodes.find((n) => n.id === 'agent:writer')?.label, 'writer', 'an agent: prefix is dropped from the label');
  assertEquals(graph.nodes.find((n) => n.id === 'planner')?.kind, 'AGENT', 'a graph node is an agent node without an AGENT span kind');
  assertEquals(graph.nodes.find((n) => n.id === 'planner')?.colorIndex, 0, 'with an agent colour');
  assertEquals(edgeOf(graph, 'planner', 'executor')?.count, 2, 'edges follow graph.node.parent_id');
  assertEquals(edgeOf(graph, START_NODE_ID, 'planner')?.count, 1, 'a graph node without a parent hangs off Start');
  assertEquals(edgeOf(graph, START_NODE_ID, 'lost')?.count, 1, 'a parent id with no node hangs off Start');
  assertEquals(edgeOf(graph, 'executor', 'reviewer')?.count, 1, 'without parent_id the nearest graph node above is the caller');
  assertEquals(edgeOf(graph, 'executor', 'tool:search')?.count, 1, 'a tool attaches to the graph node above it');
  assertEquals(edgeOf(graph, 'planner', 'llm:Planner:m1')?.count, 1, 'a model call attaches to it too and is owned by it');
  assertEquals(edgeOf(graph, 'reviewer', 'llm:reviewer:m2')?.count, 1, 'including a nested graph node');
  assertEquals(edgeOf(graph, 'planner', 'guardrails:planner')?.count, 1, 'guardrails are grouped under the graph node');
  assertEquals(edgeOf(graph, START_NODE_ID, 'tool:lookup')?.count, 1, 'an AI span outside every graph node hangs off Start');
  assertEquals(graph.nodes.find((n) => n.id === 'tool:search')?.calls[0][0], search.spanId, 'node opens its first span');
});

describe('fan-out cap', () => {
  const agent = makeSpan(null, 'run', { 'openinference.span.kind': 'AGENT', 'agent.name': 'a' });
  for (let i = 0; i < 25; i++) {
    makeSpan(agent, `execute_tool t${i}`, { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': `t${i}` }, { durationMs: 100 - i });
  }
  const graph = buildAgentGraph([agent]);
  const out = graph.edges.filter((e) => e.from === 'agent:a');
  const more = graph.nodes.find((n) => n.id === 'more:agent:a');

  assertEquals(out.length, 20, 'an agent fans out to at most 20 nodes');
  assertEquals(more?.label, '+6 more', 'the cheapest leaves are folded into one node');
  assertEquals(more?.calls.length, 6, 'which counts their calls');
  assertEquals(more?.breakdown?.map((b) => b.label), ['t24', 't23', 't22', 't21', 't20', 't19'], 'and lists them, cheapest first');
  assertEquals(graph.nodes.some((n) => n.id === 'tool:t24'), false, 'folded tools are no longer nodes');
  assertEquals(graph.nodes.some((n) => n.id === 'tool:t0'), true, 'the costly ones stay');
  assertEquals(edgeOf(graph, 'agent:a', 'more:agent:a')?.count, 6, 'the edge counts the folded calls');
  assertEquals(more?.calls[0][0], agent.children[24].spanId, 'a click opens a folded span');
});

describe('LangGraph metadata', () => {
  const meta = (node: string, step: number) => JSON.stringify({ langgraph_node: node, langgraph_step: step });
  const root = makeSpan(null, 'LangGraph', { 'openinference.span.kind': 'CHAIN' }, { startTimeMs: 0, durationMs: 100 });
  makeSpan(root, 'agent', { metadata: meta('agent', 1) }, { startTimeMs: 10, durationMs: 20 });
  // A model call inside the node repeats the node's metadata and belongs to the same visit.
  makeSpan(root, 'ChatModel', { metadata: meta('agent', 1), 'openinference.span.kind': 'LLM' }, { startTimeMs: 12, durationMs: 15 });
  makeSpan(root, 'tools', { metadata: meta('tools', 2) }, { startTimeMs: 40, durationMs: 10, statusCode: 'ERROR' });
  makeSpan(root, 'agent', { metadata: meta('agent', 3) }, { startTimeMs: 60, durationMs: 20 });
  makeSpan(root, 'not json', { metadata: 'oops' });

  const graph = buildAgentGraph([root]);
  assertEquals(graph.source, 'langgraph', 'source is LangGraph');
  assertEquals(nodeIds(graph), [START_NODE_ID, 'agent', 'tools'].sort(), 'nodes are the langgraph_node names');
  assertEquals(graph.nodes.find((n) => n.id === 'agent')?.calls.length, 2, 'a node counts one visit per step');
  assertEquals(graph.nodes.find((n) => n.id === 'agent')?.calls.flat().length, 3, 'a node lists the spans of all its visits');
  assertEquals(graph.nodes.find((n) => n.id === 'tools')?.errorCount, 1, 'a failed visit is an error');
  assertEquals(edgeOf(graph, START_NODE_ID, 'agent')?.count, 1, 'the first step hangs off Start');
  assertEquals(edgeOf(graph, 'agent', 'tools')?.count, 1, 'consecutive steps are connected');
  assertEquals(edgeOf(graph, 'tools', 'agent')?.count, 1, 'a loop back to an earlier node is an edge');
  assertEquals(edgeOf(graph, 'agent', 'tools')?.totalMs, 10, 'edge duration is the callee visit duration');
});

describe('layout', () => {
  const root = makeSpan(null, 'wf');
  makeSpan(root, 'a', { 'graph.node.id': 'a' });
  makeSpan(root, 'b', { 'graph.node.id': 'b', 'graph.node.parent_id': 'a' });
  makeSpan(root, 'c', { 'graph.node.id': 'c', 'graph.node.parent_id': 'b' });
  makeSpan(root, 'a2', { 'graph.node.id': 'a', 'graph.node.parent_id': 'c' });
  makeSpan(root, 'd', { 'graph.node.id': 'd', 'graph.node.parent_id': 'a' });

  const graph = buildAgentGraph([root]);
  const layout = layoutAgentGraph(graph);
  assertEquals(layout.layers.map((l) => [...l].sort()), [[START_NODE_ID], ['a'], ['b', 'd'], ['c']], 'layers follow the longest path from Start');
  assertEquals([...layout.backEdges].map((e) => `${e.from}>${e.to}`), ['c>a'], 'the edge that closes a cycle is a back edge');
  assertEquals(layout.layerOf.get('c'), 3, 'a node is placed after its last caller');
});

describe('layout - wide layers and deep chains', () => {
  const agent = makeSpan(null, 'run', { 'openinference.span.kind': 'AGENT', 'agent.name': 'a' });
  for (let i = 0; i < 16; i++) {
    makeSpan(agent, `execute_tool t${i}`, { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': `t${i}` });
  }
  const graph = buildAgentGraph([agent]);
  const placed = placeAgentGraph(graph, layoutAgentGraph(graph));
  const boxes = [...placed.boxes.values()];
  const overlaps = boxes.some((a, i) => boxes.slice(i + 1).some((b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height));
  assertEquals(overlaps, false, 'no two nodes overlap');
  assertEquals(boxes.every((b) => b.x >= 0 && b.y >= 0 && b.x + b.width <= placed.width && b.y + b.height <= placed.height), true, 'every node is inside the graph bounds');
  const toolColumn = [...new Set(graph.nodes.filter((n) => n.kind === 'TOOL').map((n) => placed.boxes.get(n.id)!.x))];
  assertEquals(toolColumn.length, 2, 'a layer taller than MAX_ROWS wraps into two columns');
  assertEquals(graph.nodes.filter((n) => n.kind === 'TOOL' && placed.boxes.get(n.id)!.x === toolColumn[0]).length <= MAX_ROWS, true, 'a column holds at most MAX_ROWS nodes');
  assertEquals(placed.edges.length, graph.edges.length, 'every edge is placed');

  const chain: PluginSpan[] = [];
  for (let i = 0; i < 3000; i++) {
    chain.push(makeSpan(i === 0 ? null : chain[i - 1], `agent ${i}`, { 'openinference.span.kind': 'AGENT', 'agent.name': `agent ${i}` }));
  }
  const deep = buildAgentGraph([chain[0]]);
  const deepLayout = layoutAgentGraph(deep);
  assertEquals(deepLayout.layers.length, 3001, 'a 3,000-node chain gets a layer per node, including Start, without overflowing the stack');
  assertEquals(placeAgentGraph(deep, deepLayout).boxes.size, 3001, 'and every node is placed');
});

describe('back edges are placed under the columns', () => {
  const root = makeSpan(null, 'wf');
  makeSpan(root, 'a', { 'graph.node.id': 'a' });
  makeSpan(root, 'b', { 'graph.node.id': 'b', 'graph.node.parent_id': 'a' });
  makeSpan(root, 'a2', { 'graph.node.id': 'a', 'graph.node.parent_id': 'b' });
  const graph = buildAgentGraph([root]);
  const layout = layoutAgentGraph(graph);
  const placed = placeAgentGraph(graph, layout);
  const lowest = Math.max(...[...placed.boxes.values()].map((b) => b.y + b.height));
  const back = placed.edges.find((e) => layout.backEdges.has(e.edge))!;
  assertEquals(back.label.y > lowest, true, 'the label of a loop-back edge sits below the nodes');
  assertEquals(back.label.y < placed.height, true, 'and inside the graph');
});

describe('drawing only what is in view', () => {
  // A chain of 40 agents, one per column.
  const chain: PluginSpan[] = [];
  for (let i = 0; i < 40; i++) {
    chain.push(makeSpan(i === 0 ? null : chain[i - 1], `agent ${i}`, { 'openinference.span.kind': 'AGENT', 'agent.name': `agent ${i}` }));
  }
  const graph = buildAgentGraph([chain[0]]);
  const placed = placeAgentGraph(graph, layoutAgentGraph(graph));
  const everything = getGraphInView(graph, placed, { left: -1000, top: -1000, right: placed.width + 1000, bottom: placed.height + 1000 });
  assertEquals(everything.nodeIds.length, 41, 'a view over the whole graph holds every node');
  assertEquals(everything.edges.length, 40, 'and every edge');

  const first = placed.boxes.get(START_NODE_ID)!;
  const view = { left: 0, top: 0, right: first.x + first.width + 300, bottom: placed.height };
  const near = getGraphInView(graph, placed, view);
  assertEquals(near.nodeIds.includes(START_NODE_ID), true, 'a node inside the view is drawn');
  assertEquals(near.nodeIds.includes('agent:agent 39'), false, 'a node far to the right is not');
  assertEquals(near.nodeIds.length < 6, true, 'only a few columns are drawn');
  assertEquals(near.edges.every((e) => e.bounds.left < view.right), true, 'every drawn edge reaches into the view');
  assertEquals(near.edges.some((e) => e.edge.to === 'agent:agent 39'), false, 'an edge far to the right is not drawn');

  const edgeIntoView = placed.edges.find((e) => e.edge.to === 'agent:agent 10')!;
  const onlyTheEdge = getGraphInView(graph, placed, { left: edgeIntoView.bounds.left + 20, top: 0, right: edgeIntoView.bounds.left + 30, bottom: placed.height });
  assertEquals(onlyTheEdge.edges.includes(edgeIntoView), true, 'an edge is drawn when the view holds only a stretch of its curve');
  assertEquals(getGraphInView(graph, placed, { left: -50, top: -50, right: -10, bottom: -10 }).nodeIds, [], 'a view outside the graph draws nothing');
});

describe('model calls without a model name', () => {
  const agent = makeSpan(null, 'run', { 'openinference.span.kind': 'AGENT', 'agent.name': 'a' });
  makeSpan(agent, 'generation', { 'openinference.span.kind': 'LLM' });
  makeSpan(agent, 'generation', { 'openinference.span.kind': 'LLM' });
  makeSpan(agent, 'chat', { 'openinference.span.kind': 'LLM', 'llm.model_name': 'model-x' });
  const graph = buildAgentGraph([agent]);
  const unnamed = graph.nodes.find((n) => n.id === 'llm:a:generation');
  assertEquals(unnamed?.label, 'generation', 'a model call without a model name is labelled with its span name');
  assertEquals(unnamed?.calls.length, 2, 'and its calls share one node');
  assertEquals(unnamed?.modelUnknown, true, 'the node says that the model is unknown');
  assertEquals(unnamed?.subtitle, 'a', 'it still names the agent that made the calls');
  assertEquals(graph.nodes.find((n) => n.id === 'llm:a:model-x')?.modelUnknown, false, 'a call with a model name is not marked');
});

describe('scale and scroll position of the drawn graph', () => {
  const content = { width: 1000, height: 400 };
  assertEquals(getFitScale(content, { width: 2000, height: 1000 }), 1, 'a graph that fits is drawn at 100%, never larger');
  assertEquals(getFitScale(content, { width: 504, height: 1000 }), 0.5, 'the fit scale leaves a 4px margin');
  assertEquals(getFitScale(content, { width: 2000, height: 204 }), 0.5, 'and goes by the height when that is tighter');
  assertEquals(getFitScale({ width: 100000, height: 400 }, { width: 500, height: 500 }) > 0, true, 'a huge graph still has a positive fit scale');
  assertEquals(getFitScale(content, { width: 0, height: 0 }), 1, 'an unmeasured view gives 100%');

  assertEquals(READABLE_SCALE, 0.8, 'text is never drawn below 80% by default');
  assertEquals(getDefaultScale(content, { width: 2000, height: 1000 }), 1, 'a graph that fits opens at 100%');
  assertEquals(getDefaultScale(content, { width: 904, height: 1000 }), 0.9, 'a graph that fits only when scaled down a little opens at that scale');
  assertEquals(getDefaultScale(content, { width: 504, height: 1000 }), 0.8, 'a graph that would need less than 80% opens at 80%');

  const view = { width: 600, height: 300 };
  const wide = { width: 3000, height: 800 };
  const startBox = { x: 20, y: 380, width: 76, height: 42 };
  const near = { x: 250, y: 100, width: 168, height: 42 };
  const far = { x: 2000, y: 100, width: 168, height: 42 };
  assertEquals(getInitialScroll(startBox, 1, view, wide), { left: 0, top: 251 }, 'the view opens at the left edge on Start, centred vertically');
  assertEquals(getInitialScroll(near, 1, view, wide).left, 0, 'a selected node that fits next to Start keeps Start in view');
  assertEquals(getInitialScroll(far, 1, view, wide).left, 2084 - 300, 'a selected node further right is centred');
  assertEquals(getInitialScroll(far, 1, view, { width: 2300, height: 800 }).left, 2300 - 600, 'and the view stops at the end of the graph');
  assertEquals(getInitialScroll(near, 1, view, { width: 400, height: 200 }), { left: 0, top: 0 }, 'a graph smaller than the view does not scroll');

  assertEquals(getRevealScroll(near, 1, view, { left: 0, top: 0 }, wide), undefined, 'a node that is in view is left where it is');
  assertEquals(getRevealScroll(far, 1, view, { left: 0, top: 0 }, wide), { left: 2084 - 300, top: 0 }, 'a node out of view horizontally is centred, without moving the other axis');
  assertEquals(getRevealScroll(far, 1, view, { left: 1900, top: 0 }, wide), undefined, 'including when the scroll position is part way');
  assertEquals(getRevealScroll(near, 1, view, { left: 400, top: 0 }, wide), { left: 34, top: 0 }, 'a node scrolled out to the left is brought back');
  assertEquals(getRevealScroll({ x: 250, y: 700, width: 168, height: 42 }, 0.5, view, { left: 0, top: 0 }, wide), { left: 0, top: 100 }, 'the scale is applied first: this node sits at y 350 on screen, past a 300px view, and the scroll stops at the end of the graph');
});

describe('zooming with the wheel', () => {
  const content = { width: 1000, height: 400 };
  const range = getZoomRange(content, { width: 504, height: 1000 });
  assertEquals(range.min, 0.5, 'the smallest zoom is the scale that fits the whole graph');
  assertEquals(range.max, 2, 'the largest zoom is 200%');
  assertEquals(MAX_ZOOM, 2, 'and is exported');
  assertEquals(getZoomRange({ width: 100000, height: 400 }, { width: 500, height: 500 }).min, 0.3, 'a huge graph does not zoom out below 30%');
  assertEquals(getZoomRange(content, { width: 2000, height: 1000 }).min, 1, 'a graph that fits at 100% does not zoom out');

  assertEquals(clampZoom(1.5, 1, range), 1.5, 'a zoom inside the range is kept');
  assertEquals(clampZoom(3, 1, range), 2, 'a zoom above the range stops at the largest');
  assertEquals(clampZoom(0.2, 1, range), 0.5, 'a zoom below the range stops at the fit scale');
  assertEquals(clampZoom(0.04, 0.05, range), 0.05, 'a view already below the range (after Fit) does not jump up when zooming out');
  assertEquals(clampZoom(0.2, 0.05, range), 0.2, 'but zooming in from there is allowed');

  assertEquals(normalizeWheelDelta(100, 0), 100, 'pixel deltas are kept');
  assertEquals(normalizeWheelDelta(3, 1), 96, 'a line delta becomes pixels: three lines are about one wheel notch');
  assertEquals(normalizeWheelDelta(1, 2), 800, 'a page delta becomes pixels');
  assertEquals(normalizeWheelDelta(-3, 1), -96, 'the sign is kept');

  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  assertEquals(near(getWheelZoomScale(1, -100, 0, false, range), Math.exp(0.2)), true, 'a wheel notch up zooms in by a step');
  assertEquals(near(getWheelZoomScale(1, 100, 0, false, range), Math.exp(-0.2)), true, 'a notch down zooms out by the same factor');
  assertEquals(near(getWheelZoomScale(1, -1, 0, false, range), Math.exp(0.002)), true, 'a one pixel trackpad delta zooms by a hair');
  assertEquals(near(getWheelZoomScale(1, -3, 1, false, range), Math.exp(0.192)), true, 'line deltas are normalised before they zoom');
  assertEquals(getWheelZoomScale(1, -10, 0, true, range) > getWheelZoomScale(1, -10, 0, false, range), true, 'a pinch (ctrl) delta zooms faster than the same wheel delta');
  assertEquals(near(getWheelZoomScale(1, -10, 0, true, range), Math.exp(0.1)), true, 'by five times as much');
  assertEquals(getWheelZoomScale(1.9, -500, 0, false, range), 2, 'wheel zoom stops at the largest');
  assertEquals(getWheelZoomScale(0.7, 500, 0, false, range), 0.5, 'and at the fit scale');
  assertEquals(getWheelZoomScale(0.8, 0, 0, false, range), 0.8, 'no delta, no zoom');

  // The graph point under the pointer stays under the pointer.
  const scroll = { left: 300, top: 40 };
  const pointer = { x: 250, y: 120 };
  const anchor = getAnchor(scroll, pointer, 0.8);
  assertEquals(near(anchor.x, (300 + 250) / 0.8) && near(anchor.y, (40 + 120) / 0.8), true, 'the anchor is the graph point under the pointer');
  for (const next of [0.5, 1, 1.7, 2]) {
    const to = getAnchoredScroll(anchor, next);
    assertEquals(near((to.left + pointer.x) / next, anchor.x) && near((to.top + pointer.y) / next, anchor.y), true, `at ${next} the same graph point is still under the pointer`);
  }
  assertEquals(getAnchoredScroll(anchor, 0.8), scroll, 'at the scale it was taken at, the scroll position is unchanged');
});

describe('calls', () => {
  // call_llm wraps a generate span of the same model: two spans, one call.
  const agent = makeSpan(null, 'run', { 'openinference.span.kind': 'AGENT', 'agent.name': 'a' });
  const wrapper1 = makeSpan(agent, 'call_llm', { 'gen_ai.operation.name': 'call_llm', 'gen_ai.request.model': 'm' });
  const inner1 = makeSpan(wrapper1, 'generate', { 'openinference.span.kind': 'LLM', 'llm.model_name': 'm' });
  const wrapper2 = makeSpan(agent, 'call_llm', { 'gen_ai.operation.name': 'call_llm', 'gen_ai.request.model': 'm' });
  const inner2 = makeSpan(wrapper2, 'generate', { 'openinference.span.kind': 'LLM', 'llm.model_name': 'm' });
  const graph = buildAgentGraph([agent]);
  const model = graph.nodes.find((n) => n.kind === 'LLM')!;
  assertEquals(model.calls, [[wrapper1.spanId, inner1.spanId], [wrapper2.spanId, inner2.spanId]], 'a wrapper span and the call it wraps are one call, wrapper first');
  assertEquals(model.calls.length, 2, 'the node counts calls, not spans');
});

describe('selection mapping', () => {
  const agent = makeSpan(null, 'run', { 'openinference.span.kind': 'AGENT', 'agent.name': 'a' });
  const tool1 = makeSpan(agent, 'execute_tool t', { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': 't' });
  const http = makeSpan(agent, 'GET /x');
  const tool2 = makeSpan(http, 'execute_tool t', { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': 't' });
  const tool3 = makeSpan(agent, 'execute_tool t', { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': 't' });
  const other = makeSpan(agent, 'execute_tool u', { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': 'u' });
  const graph = buildAgentGraph([agent]);
  const locations = indexGraphSpans(graph);
  const node = (id: string) => graph.nodes.find((n) => n.id === id)!;

  assertEquals(locations.get(agent.spanId), { nodeId: 'agent:a', call: 0 }, 'an agent span maps to its node');
  assertEquals(locations.get(tool2.spanId), { nodeId: 'tool:t', call: 1 }, 'a span maps to the node and the call index, whatever it is nested in');
  assertEquals(locations.get(other.spanId)?.nodeId, 'tool:u', 'each span maps to its own node');
  assertEquals(locations.has(http.spanId), false, 'a span that is not in the graph has no location');
  assertEquals(locations.size, 5, 'every span of the graph is indexed once');

  const t = node('tool:t');
  assertEquals(getNodeClickTarget(t, undefined), tool1.spanId, 'a click with nothing selected opens the first call');
  assertEquals(getNodeClickTarget(t, locations.get(other.spanId)), tool1.spanId, 'a click on another node than the selected one opens the first call');
  assertEquals(getNodeClickTarget(t, locations.get(tool1.spanId)), tool2.spanId, 'a click on the selected node steps to the next call');
  assertEquals(getNodeClickTarget(t, locations.get(tool2.spanId)), tool3.spanId, 'and again');
  assertEquals(getNodeClickTarget(t, locations.get(tool3.spanId)), tool1.spanId, 'after the last call it wraps to the first');
  assertEquals(getNodeClickTarget(node('tool:u'), locations.get(other.spanId)), other.spanId, 'a node with one call keeps its span');
  assertEquals(getNodeClickTarget(node(START_NODE_ID), undefined), undefined, 'the Start node opens nothing');

  const wrapped = makeSpan(null, 'run', { 'openinference.span.kind': 'AGENT', 'agent.name': 'w' });
  const w1 = makeSpan(wrapped, 'call_llm', { 'gen_ai.operation.name': 'call_llm', 'gen_ai.request.model': 'm' });
  const w1Inner = makeSpan(w1, 'generate', { 'openinference.span.kind': 'LLM', 'llm.model_name': 'm' });
  const w2 = makeSpan(wrapped, 'call_llm', { 'gen_ai.operation.name': 'call_llm', 'gen_ai.request.model': 'm' });
  const wGraph = buildAgentGraph([wrapped]);
  const wLocations = indexGraphSpans(wGraph);
  const model = wGraph.nodes.find((n) => n.kind === 'LLM')!;
  assertEquals(wLocations.get(w1Inner.spanId)?.call, 0, 'a span nested in a call maps to that call');
  assertEquals(getNodeClickTarget(model, wLocations.get(w1Inner.spanId)), w2.spanId, 'stepping from a nested span goes to the next call, not to its wrapper');
});

describe('graph cache', () => {
  const roots = [makeSpan(null, 'run', { 'openinference.span.kind': 'AGENT', 'agent.name': 'a' })];
  const first = getAgentGraph(roots);
  assertEquals(getAgentGraph(roots) === first, true, 'the graph of one span tree is built once');
  assertEquals(getAgentGraph([...roots]) === first, false, 'another span tree gets its own graph');
});

describe('build time', () => {
  // 30,000 spans: 10 agents with 100 rounds each of a model call, 8 tool calls and an HTTP span.
  const root = makeSpan(null, 'workflow', { 'openinference.span.kind': 'CHAIN' });
  let spanCount = 1;
  for (let a = 0; a < 10; a++) {
    const agent = makeSpan(root, `run a${a}`, { 'openinference.span.kind': 'AGENT', 'agent.name': `a${a}` });
    spanCount++;
    for (let round = 0; round < 100; round++) {
      makeSpan(agent, 'chat', { 'openinference.span.kind': 'LLM', 'llm.model_name': 'm' });
      for (let t = 0; t < 8; t++) {
        makeSpan(makeSpan(agent, 'POST /x'), `execute_tool t${t}`, { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': `t${t}` });
        spanCount += 2;
      }
      spanCount++;
    }
  }
  const started = performance.now();
  const graph = buildAgentGraph([root]);
  const layout = layoutAgentGraph(graph);
  placeAgentGraph(graph, layout);
  const elapsed = performance.now() - started;
  console.log(`  ${spanCount} spans: build + layout + placement ${elapsed.toFixed(1)} ms`);
  assertEquals(elapsed < 1000, true, 'a trace of about 18,000 spans builds, lays out and places in under a second');
  assertEquals(graph.nodes.find((n) => n.id === 'tool:t0')?.calls.length, 1000, 'tool calls are counted across agents');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

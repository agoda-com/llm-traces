import type { PluginSpan } from './tempoClient.ts';
import type { KeyValuePair } from './llmUtils.ts';
import { getAgentName, getGraphNode, getSpanKind } from './llmUtils.ts';
import { getGraphNodeLabel } from './traceTree.ts';

export const START_NODE_ID = '__start__';

/** Where the structure of a graph comes from. */
export type GraphSource = 'graph-attributes' | 'langgraph' | 'inferred';

/**
 * One counted call of a node, as the ids of its spans. The first span is the one that opens when the node is
 * clicked. A call can hold more spans, e.g. an ADK model call wraps a span for the same request.
 */
export type GraphCall = string[];

export interface GraphNode {
  id: string;
  /** Span kind such as AGENT or TOOL; START for the entry node. */
  kind: string;
  label: string;
  /** Second line for nodes that share a label, e.g. the agent a model node belongs to. */
  subtitle?: string;
  /** Position of the agent among the trace's agents, for AGENT nodes. */
  colorIndex?: number;
  /** For a model call whose spans record no model name: the label is the span name instead. */
  modelUnknown?: boolean;
  /** In trace order. */
  calls: GraphCall[];
  totalMs: number;
  errorCount: number;
  /** For a node that stands for several named things, e.g. Guardrails: how many calls each name got. */
  breakdown?: Array<{ label: string; count: number }>;
}

export interface GraphEdge {
  from: string;
  to: string;
  count: number;
  totalMs: number;
  errorCount: number;
}

export interface AgentGraph {
  source: GraphSource;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const MODEL_CALL_KINDS = new Set(['LLM', 'EMBEDDING', 'RERANKER']);
/** Nodes that nothing attaches to: what runs below them attaches to the node above. */
const LEAF_KINDS = new Set([...MODEL_CALL_KINDS, 'GUARDRAIL']);

function tagValue(tags: KeyValuePair[], key: string): string | undefined {
  const value = tags.find((t) => t.key === key)?.value;
  return value === undefined || value === null || value === '' ? undefined : String(value);
}

function isError(span: PluginSpan): boolean {
  return span.statusCode === 'ERROR';
}

/** Visits every span of the forest in trace order, without recursion, so a deep trace cannot overflow the stack. */
function walk(roots: PluginSpan[], visit: (span: PluginSpan) => void): void {
  const pending: PluginSpan[] = [];
  for (let i = roots.length - 1; i >= 0; i--) {
    pending.push(roots[i]);
  }
  for (let span = pending.pop(); span; span = pending.pop()) {
    visit(span);
    for (let i = span.children.length - 1; i >= 0; i--) {
      pending.push(span.children[i]);
    }
  }
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  return groups;
}

class GraphBuilder {
  private nodes = new Map<string, GraphNode>();
  private edges = new Map<string, GraphEdge>();

  constructor() {
    this.nodes.set(START_NODE_ID, { id: START_NODE_ID, kind: 'START', label: 'Start', calls: [], totalMs: 0, errorCount: 0 });
  }

  node(id: string, init: Pick<GraphNode, 'kind' | 'label' | 'subtitle' | 'colorIndex' | 'modelUnknown'>): GraphNode {
    let node = this.nodes.get(id);
    if (!node) {
      node = { id, ...init, calls: [], totalMs: 0, errorCount: 0 };
      this.nodes.set(id, node);
    }
    return node;
  }

  edge(from: string, to: string): GraphEdge {
    const key = `${from}\u0000${to}`;
    let edge = this.edges.get(key);
    if (!edge) {
      edge = { from, to, count: 0, totalMs: 0, errorCount: 0 };
      this.edges.set(key, edge);
    }
    return edge;
  }

  /** Counts one call of `node` made through `edge`, and returns the call so that more spans can join it. */
  addCall(node: GraphNode, edge: GraphEdge, spanIds: GraphCall, durationMs: number, failed: boolean): GraphCall {
    node.calls.push(spanIds);
    node.totalMs += durationMs;
    edge.count++;
    edge.totalMs += durationMs;
    if (failed) {
      node.errorCount++;
      edge.errorCount++;
    }
    return spanIds;
  }

  build(source: GraphSource): AgentGraph {
    return { source, nodes: [...this.nodes.values()], edges: [...this.edges.values()] };
  }
}

// ---- Explicit structure: LangGraph metadata ----

/** Spans of one node in one step. Spans inside a LangGraph node repeat its metadata, so they join its visit. */
interface LangGraphVisit {
  node: string;
  step: number;
  startMs: number;
  endMs: number;
  failed: boolean;
  kind: string;
  spanIds: string[];
}

function parseLangGraphMetadata(tags: KeyValuePair[]): { node: string; step: number } | undefined {
  const raw = tags.find((t) => t.key === 'metadata')?.value;
  let metadata: unknown = raw;
  if (typeof raw === 'string') {
    try {
      metadata = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (!metadata || typeof metadata !== 'object') {
    return undefined;
  }
  const { langgraph_node: node, langgraph_step: step } = metadata as Record<string, unknown>;
  if (typeof node !== 'string' || node === '') {
    return undefined;
  }
  return { node, step: Number(step) };
}

function buildFromLangGraph(roots: PluginSpan[]): AgentGraph | undefined {
  const visits = new Map<string, LangGraphVisit>();
  walk(roots, (span) => {
    const meta = parseLangGraphMetadata(span.tags);
    if (!meta || meta.node === START_NODE_ID) {
      return;
    }
    const key = `${meta.node}\u0000${meta.step}`;
    const endMs = span.startTimeMs + span.durationMs;
    const visit = visits.get(key);
    if (visit) {
      visit.startMs = Math.min(visit.startMs, span.startTimeMs);
      visit.endMs = Math.max(visit.endMs, endMs);
      visit.failed ||= isError(span);
      visit.spanIds.push(span.spanId);
    } else {
      visits.set(key, {
        ...meta, startMs: span.startTimeMs, endMs, failed: isError(span), kind: getSpanKind(span.tags) ?? 'CHAIN', spanIds: [span.spanId],
      });
    }
  });
  if (visits.size === 0) {
    return undefined;
  }
  // Consecutive visits with the same step number run in parallel and form one step. A run that starts over at a
  // lower step number is the next invocation of the graph.
  const ordered = [...visits.values()].sort((a, b) => a.startMs - b.startMs || a.step - b.step);
  const steps: LangGraphVisit[][] = [];
  for (const visit of ordered) {
    const last = steps[steps.length - 1];
    if (last && last[0].step === visit.step) {
      last.push(visit);
    } else {
      steps.push([visit]);
    }
  }
  const builder = new GraphBuilder();
  steps.forEach((step, i) => {
    // Each node of a step follows every node of the step before.
    const callers = i === 0 ? [START_NODE_ID] : [...new Set(steps[i - 1].map((v) => v.node))];
    for (const visit of step) {
      const node = builder.node(visit.node, { kind: visit.kind, label: visit.node });
      const durationMs = visit.endMs - visit.startMs;
      node.calls.push(visit.spanIds);
      node.totalMs += durationMs;
      node.errorCount += visit.failed ? 1 : 0;
      for (const caller of callers.filter((from) => from !== visit.node)) {
        const edge = builder.edge(caller, visit.node);
        edge.count++;
        edge.totalMs += durationMs;
        edge.errorCount += visit.failed ? 1 : 0;
      }
    }
  });
  return builder.build('langgraph');
}

// ---- Inference from nesting ----

/** What a span stands for in the graph, before it is matched to an existing node. */
interface Descriptor {
  id: string;
  kind: string;
  label: string;
  subtitle?: string;
  modelUnknown?: boolean;
  /** Model names of a model call, so a framework's wrapper span and the call it wraps resolve to one node. */
  models?: string[];
}

/** A node the walk is inside of, with the edge and call that reached it. */
interface Reached {
  node: GraphNode;
  edge: GraphEdge;
  call: GraphCall;
  models?: string[];
}

/** Where the next AI span below attaches. */
interface Context {
  /** The nearest agent, tool or retriever node. */
  parent?: Reached;
  /** The model-call node the span is nested in, so a wrapper span and the call it wraps count once. */
  modelCall?: Reached;
  /** Label of the nearest agent node, which owns the model calls below it. */
  agent?: string;
}

function toolName(span: PluginSpan): string {
  return tagValue(span.tags, 'gen_ai.tool.name') ?? tagValue(span.tags, 'tool.name') ?? span.operationName.replace(/^execute_tool\s+/, '');
}

/**
 * ADK runs an agent used as a tool as execute_tool X > invocation > invoke_agent X. The tool is the same thing as
 * the agent, so the agent takes the tool's place in the graph.
 */
function wrapsAgentNamed(tool: PluginSpan, name: string): boolean {
  const pending = [...tool.children];
  for (let span = pending.pop(); span; span = pending.pop()) {
    const kind = getSpanKind(span.tags);
    if (kind === 'AGENT') {
      if ((getAgentName(span.tags, span.operationName) ?? span.operationName) === name) {
        return true;
      }
    } else if (kind === undefined || kind === 'CHAIN') {
      pending.push(...span.children);
    }
  }
  return false;
}

function modelsOf(span: PluginSpan): string[] {
  const names = ['gen_ai.request.model', 'llm.model_name', 'gen_ai.response.model'].map((key) => tagValue(span.tags, key));
  return [...new Set(names.filter((n): n is string => !!n))];
}

function describe(span: PluginSpan, kind: string, agentName: string | undefined): Descriptor | undefined {
  switch (kind) {
    case 'AGENT': {
      const name = getAgentName(span.tags, span.operationName) ?? span.operationName;
      return { id: `agent:${name}`, kind, label: name };
    }
    case 'TOOL': {
      const name = toolName(span);
      // ADK emits a placeholder span, "(merged tools)", for the combined response of parallel tool calls.
      if (/^\(merged/.test(name) || wrapsAgentNamed(span, name)) {
        return undefined;
      }
      return { id: `tool:${name}`, kind, label: name };
    }
    case 'LLM':
    case 'EMBEDDING':
    case 'RERANKER': {
      const models = modelsOf(span);
      // A call without a model name is labelled with its span name.
      const label = models[0] ?? span.operationName;
      // Only chat models belong to the agent that calls them; embeddings and rerankers are shared.
      const owner = kind === 'LLM' ? agentName ?? '' : '';
      return { id: `${kind.toLowerCase()}:${owner}:${label}`, kind, label, subtitle: owner || undefined, modelUnknown: models.length === 0, models };
    }
    case 'GUARDRAIL':
    case 'RETRIEVER': {
      const name = span.operationName.replace(/^(?:guardrail|retrieval|retriever)\s+/i, '');
      return { id: `${kind.toLowerCase()}:${name}`, kind, label: name };
    }
    default:
      return undefined;
  }
}

function sharesModel(a: string[] | undefined, b: string[] | undefined): boolean {
  return !!a && !!b && a.some((m) => b.includes(m));
}

/** The ids that spans declare as OpenInference graph nodes. */
function declaredGraphNodeIds(roots: PluginSpan[]): Set<string> {
  const ids = new Set<string>();
  walk(roots, (span) => {
    const declared = getGraphNode(span.tags);
    if (declared) {
      ids.add(declared.id);
    }
  });
  return ids;
}

/**
 * Walks the span tree once. A span that declares a graph.node.id is an agent node whatever its kind, and its
 * graph.node.parent_id (when it names another graph node) gives its caller. Every other AI span becomes a node by
 * the inference rules and attaches to the nearest node above it.
 */
function buildByInference(roots: PluginSpan[], graphNodeIds: Set<string>): AgentGraph {
  const builder = new GraphBuilder();
  let agentCount = 0;
  const pending: Array<{ span: PluginSpan; context: Context }> = [];
  for (let i = roots.length - 1; i >= 0; i--) {
    pending.push({ span: roots[i], context: {} });
  }
  while (pending.length > 0) {
    const { span, context } = pending.pop()!;
    let next = context;
    const kind = getSpanKind(span.tags);
    const declared = getGraphNode(span.tags);
    const descriptor: Descriptor | undefined = declared
      ? { id: declared.id, kind: 'AGENT', label: getGraphNodeLabel(span, declared) }
      : kind ? describe(span, kind, context.agent) : undefined;
    if (descriptor) {
      const { parent, modelCall } = context;
      const repeated = descriptor.id === parent?.node.id
        ? parent
        : modelCall && MODEL_CALL_KINDS.has(descriptor.kind) && sharesModel(descriptor.models, modelCall.models)
          ? modelCall
          : undefined;
      if (repeated) {
        // The span repeats the call of the node it sits in: it joins that call.
        repeated.call.push(span.spanId);
        if (isError(span)) {
          repeated.node.errorCount++;
          repeated.edge.errorCount++;
        }
      } else {
        const declaredParent = declared?.parentId;
        const parentId = declaredParent && declaredParent !== declared.id && graphNodeIds.has(declaredParent)
          ? declaredParent
          : parent?.node.id ?? START_NODE_ID;
        const grouped = descriptor.kind === 'GUARDRAIL';
        const id = grouped ? `guardrails:${parentId}` : descriptor.id;
        const node = builder.node(id, grouped ? { kind: descriptor.kind, label: 'Guardrails' } : descriptor);
        if (node.kind === 'AGENT' && node.colorIndex === undefined) {
          node.colorIndex = agentCount++;
        }
        const edge = builder.edge(parentId, id);
        const call = builder.addCall(node, edge, [span.spanId], span.durationMs, isError(span));
        if (grouped) {
          node.breakdown ??= [];
          const entry = node.breakdown.find((e) => e.label === descriptor.label);
          if (entry) {
            entry.count++;
          } else {
            node.breakdown.push({ label: descriptor.label, count: 1 });
          }
        }
        if (!LEAF_KINDS.has(descriptor.kind)) {
          next = { parent: { node, edge, call }, agent: node.kind === 'AGENT' ? node.label : context.agent };
        } else if (MODEL_CALL_KINDS.has(descriptor.kind)) {
          next = { ...context, modelCall: { node, edge, call, models: descriptor.models } };
        }
      }
    }
    for (let i = span.children.length - 1; i >= 0; i--) {
      pending.push({ span: span.children[i], context: next });
    }
  }
  return builder.build(graphNodeIds.size > 0 ? 'graph-attributes' : 'inferred');
}

// ---- Fan-out cap ----

/** The most nodes one node fans out to before its least costly leaves are folded into one "more" node. */
const MAX_FAN_OUT = 20;

/**
 * Folds the cheapest leaf children of a node that fans out to more than MAX_FAN_OUT nodes into a single "+N more"
 * node, so a long list of rarely used tools stays one readable column. Only leaves that nothing else calls are
 * folded.
 */
function capFanOut(graph: AgentGraph): AgentGraph {
  const callsOf = groupBy(graph.edges, (e) => e.from);
  const callersOf = groupBy(graph.edges, (e) => e.to);
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const folded = new Set<string>();
  const moreNodes: GraphNode[] = [];
  const moreEdges: GraphEdge[] = [];
  for (const [from, outgoing] of callsOf) {
    if (outgoing.length <= MAX_FAN_OUT) {
      continue;
    }
    const leaves = outgoing
      .filter((e) => !callsOf.has(e.to) && callersOf.get(e.to)!.length === 1)
      .sort((a, b) => a.totalMs - b.totalMs);
    // Keep MAX_FAN_OUT - 1 nodes and the "more" node, but never fold fewer than two leaves into it.
    const fold = leaves.slice(0, Math.min(leaves.length, outgoing.length - MAX_FAN_OUT + 1));
    if (fold.length < 2) {
      continue;
    }
    const more: GraphNode = { id: `more:${from}`, kind: 'OTHER', label: `+${fold.length} more`, calls: [], totalMs: 0, errorCount: 0, breakdown: [] };
    const edge: GraphEdge = { from, to: more.id, count: 0, totalMs: 0, errorCount: 0 };
    for (const e of fold) {
      const node = nodeById.get(e.to)!;
      folded.add(node.id);
      more.calls.push(...node.calls);
      more.totalMs += node.totalMs;
      more.errorCount += node.errorCount;
      more.breakdown!.push({ label: node.label, count: node.calls.length });
      edge.count += e.count;
      edge.totalMs += e.totalMs;
      edge.errorCount += e.errorCount;
    }
    moreNodes.push(more);
    moreEdges.push(edge);
  }
  if (folded.size === 0) {
    return graph;
  }
  return {
    source: graph.source,
    nodes: [...graph.nodes.filter((n) => !folded.has(n.id)), ...moreNodes],
    edges: [...graph.edges.filter((e) => !folded.has(e.to)), ...moreEdges],
  };
}

/**
 * The call graph of a trace: one node per agent, tool, model, guardrail and retriever, and one edge per caller and
 * callee pair with the number of calls. Spans that are not AI spans (HTTP, chains, framework wrappers) are skipped.
 * Tools, sub-agents and retrievers hang off their nearest agent, tool or retriever ancestor and model calls off the
 * node that owns them; the guardrails of one owner share a single node. Explicit structure in the spans wins over
 * that: OpenInference graph.node.id / graph.node.parent_id define the agent nodes and their edges (everything else
 * is still inferred below them), and without those, LangGraph metadata defines the whole graph.
 */
export function buildAgentGraph(roots: PluginSpan[]): AgentGraph {
  const graphNodeIds = declaredGraphNodeIds(roots);
  if (graphNodeIds.size === 0) {
    const langGraph = buildFromLangGraph(roots);
    if (langGraph) {
      return langGraph;
    }
  }
  return capFanOut(buildByInference(roots, graphNodeIds));
}

const graphCache = new WeakMap<PluginSpan[], AgentGraph>();

/** The graph of a loaded trace, built on first use and kept for as long as the trace's span tree is. */
export function getAgentGraph(roots: PluginSpan[]): AgentGraph {
  let graph = graphCache.get(roots);
  if (!graph) {
    graph = buildAgentGraph(roots);
    graphCache.set(roots, graph);
  }
  return graph;
}

// ---- Selection ----

/** Where a span sits in the graph: the node it belongs to and the index of the call that holds it. */
export interface GraphSpanLocation {
  nodeId: string;
  call: number;
}

/** Every span that belongs to a node, by span id. Spans outside the graph are not in the map. */
export function indexGraphSpans(graph: AgentGraph): Map<string, GraphSpanLocation> {
  const locations = new Map<string, GraphSpanLocation>();
  for (const node of graph.nodes) {
    node.calls.forEach((spanIds, call) => spanIds.forEach((spanId) => locations.set(spanId, { nodeId: node.id, call })));
  }
  return locations;
}

/**
 * The span a click on `node` selects. When the selected span already belongs to the node, that is the first span of
 * its next call, wrapping around after the last; otherwise it is the first span of the first call.
 */
export function getNodeClickTarget(node: GraphNode, selected: GraphSpanLocation | undefined): string | undefined {
  if (node.calls.length === 0) {
    return undefined;
  }
  const next = selected?.nodeId === node.id ? (selected.call + 1) % node.calls.length : 0;
  return node.calls[next][0];
}

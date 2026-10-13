// Unit tests for traceTree.ts (tree walks and collapse state)
// Run with: node --experimental-strip-types tests/traceTree.unit.test.ts

import {
  collapseOneLevel,
  expandOneLevel,
  getAncestorIds,
  getParentSpanIds,
  getSpanAgents,
  getVisibleSpans,
  indexSpans,
  revealSpan,
} from '../src/utils/traceTree.ts';
import type { PluginSpan } from '../src/utils/tempoClient.ts';

let passed = 0;
let failed = 0;

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    console.error(`  FAIL: ${message} - expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed++;
  } else {
    console.log(`  pass: ${message}`);
    passed++;
  }
}

function assertSet(actual: Set<string>, expected: string[], message: string): void {
  const a = JSON.stringify([...actual].sort());
  const e = JSON.stringify([...expected].sort());
  assertEquals(a, e, message);
}

function describe(name: string, fn: () => void): void {
  console.log(`\n=== ${name} ===`);
  fn();
}

function makeSpan(spanId: string, parent: PluginSpan | null, tags: PluginSpan['tags'] = [], operationName: string = spanId): PluginSpan {
  const span: PluginSpan = {
    traceId: 't',
    spanId,
    parentSpanId: parent ? parent.spanId : null,
    operationName,
    serviceName: 'svc',
    serviceAttributes: [],
    startTimeMs: 0,
    durationMs: 1,
    tags,
    logs: [],
    children: [],
    depth: parent ? parent.depth + 1 : 0,
  };
  parent?.children.push(span);
  return span;
}

// r
//   a
//     a1
//       a1x
//     a2
//   b
//     b1
//   c
function buildSample() {
  const r = makeSpan('r', null);
  const a = makeSpan('a', r);
  const a1 = makeSpan('a1', a);
  const a1x = makeSpan('a1x', a1);
  const a2 = makeSpan('a2', a);
  const b = makeSpan('b', r);
  const b1 = makeSpan('b1', b);
  const c = makeSpan('c', r);
  const flat = [r, a, a1, a1x, a2, b, b1, c];
  return { roots: [r], flat };
}

const ids = (spans: PluginSpan[]) => spans.map((s) => s.spanId);

describe('getVisibleSpans', () => {
  const { roots } = buildSample();
  assertEquals(ids(getVisibleSpans(roots, new Set())).join(','), 'r,a,a1,a1x,a2,b,b1,c', 'nothing collapsed: pre-order of all spans');
  assertEquals(ids(getVisibleSpans(roots, new Set(['a']))).join(','), 'r,a,b,b1,c', 'collapsed span stays, its descendants go');
  assertEquals(ids(getVisibleSpans(roots, new Set(['r']))).join(','), 'r', 'collapsed root hides the whole tree');
});

describe('getParentSpanIds', () => {
  const { flat } = buildSample();
  assertEquals(getParentSpanIds(flat).join(','), 'r,a,a1,b', 'only spans with children');
});

describe('collapseOneLevel', () => {
  const { flat } = buildSample();
  const first = collapseOneLevel(flat, new Set());
  assertSet(first, ['a1', 'b'], 'hides the deepest expanded parents first');
  const second = collapseOneLevel(flat, first);
  assertSet(second, ['a1', 'b', 'a'], 'next level hides their parents');
  const third = collapseOneLevel(flat, second);
  assertSet(third, ['a1', 'b', 'a', 'r'], 'last level hides the root');
  assertEquals(collapseOneLevel(flat, third), third, 'everything collapsed: same set is returned');
});

describe('expandOneLevel', () => {
  const { flat } = buildSample();
  const all = new Set(['a1', 'b', 'a', 'r']);
  const first = expandOneLevel(flat, all);
  assertSet(first, ['a1', 'b', 'a'], 'reveals the shallowest hidden parent');
  const second = expandOneLevel(flat, first);
  assertSet(second, ['a1'], 'siblings at the same depth open together');
  const third = expandOneLevel(flat, second);
  assertSet(third, [], 'last hidden parent opens');
  const empty = new Set<string>();
  assertEquals(expandOneLevel(flat, empty), empty, 'nothing hidden: same set is returned');
});

describe('getAncestorIds', () => {
  const { flat } = buildSample();
  const byId = indexSpans(flat);
  const a1x = byId.get('a1x')!;
  assertEquals(getAncestorIds(a1x, byId).join(','), 'r,a,a1', 'ancestors are listed root first');
  assertEquals(getAncestorIds(a1x, byId, 2).join(','), 'a,a1', 'limit keeps the nearest ancestors');
  assertEquals(getAncestorIds(byId.get('r')!, byId).length, 0, 'root has no ancestors');
});

describe('revealSpan', () => {
  const { flat } = buildSample();
  const byId = indexSpans(flat);
  assertSet(revealSpan('a1x', byId, new Set(['r', 'a', 'b'])), ['b'], 'expands the collapsed ancestors only');
  const untouched = new Set(['b']);
  assertEquals(revealSpan('a1x', byId, untouched), untouched, 'no collapsed ancestor: same set is returned');
  assertSet(revealSpan('a', byId, new Set(['a'])), ['a'], 'a collapsed span itself stays collapsed');
});

describe('5,000-level chain', () => {
  const depth = 5000;
  const chain: PluginSpan[] = [];
  for (let i = 0; i < depth; i++) {
    chain.push(makeSpan(`s${i}`, i === 0 ? null : chain[i - 1]));
  }
  const byId = indexSpans(chain);
  assertEquals(getVisibleSpans([chain[0]], new Set()).length, depth, 'visible spans of the whole chain');
  assertEquals(getVisibleSpans([chain[0]], new Set(['s10'])).length, 11, 'collapsing a span cuts the chain');
  assertEquals(getAncestorIds(chain[depth - 1], byId).length, depth - 1, 'every ancestor is found');
  assertEquals(getParentSpanIds(chain).length, depth - 1, 'every span but the last is a parent');
  assertEquals(collapseOneLevel(chain, new Set()).size, 1, 'collapse one level on a chain hides only the deepest parent');
  assertSet(revealSpan(`s${depth - 1}`, byId, new Set(['s5', 's4000'])), [], 'reveal walks the whole chain');
});

const kind = (value: string) => ({ key: 'openinference.span.kind', value });
const agentTags = (name: string) => [kind('AGENT'), { key: 'gen_ai.agent.name', value: name }];

describe('agent ownership', () => {
  // root (no agent)
  //   early_tool
  //   coordinator
  //     llm1
  //     planner
  //       llm2
  //       tool2
  //     coordinator (same name again)
  //       llm3
  //   unowned_tool
  const root = makeSpan('root', null, [kind('CHAIN')]);
  const early = makeSpan('early', root, [kind('TOOL')]);
  const coord = makeSpan('coord', root, agentTags('coordinator'));
  makeSpan('llm1', coord, [kind('LLM')]);
  const planner = makeSpan('planner', coord, [kind('AGENT')], 'invoke_agent planner');
  makeSpan('llm2', planner, [kind('LLM')]);
  makeSpan('tool2', planner, [kind('TOOL')]);
  const again = makeSpan('again', coord, agentTags('coordinator'));
  makeSpan('llm3', again, [kind('LLM')]);
  const late = makeSpan('late', root, [kind('TOOL'), { key: 'gen_ai.agent.name', value: 'ignored' }]);
  const agents = getSpanAgents([root]);

  assertEquals(agents.has('root'), false, 'a span above every agent has no owner');
  assertEquals(agents.has(early.spanId), false, 'a sibling before the first agent has no owner');
  assertEquals(agents.has(late.spanId), false, 'a non-agent span is not an agent even with an agent name attribute');
  assertEquals(agents.get('coord')?.name, 'coordinator', 'an agent span owns itself');
  assertEquals(agents.get('coord')?.handoffFrom, undefined, 'a top-level agent was not handed off from anyone');
  assertEquals(agents.get('llm1')?.name, 'coordinator', 'a child of an agent is owned by it');
  assertEquals(agents.get('planner')?.name, 'planner', 'the agent name comes from the span name when there is no attribute');
  assertEquals(agents.get('planner')?.handoffFrom, 'coordinator', 'a nested agent is handed off from its parent agent');
  assertEquals(agents.get('llm2')?.name, 'planner', 'the nearest agent owns the span');
  assertEquals(agents.get('tool2')?.name, 'planner', 'a tool span is owned by the nearest agent');
  assertEquals(agents.get('llm2')?.handoffFrom, 'coordinator', 'owned spans share their agent record');
  assertEquals(agents.get('again')?.name, 'coordinator', 'the same agent name nests');
  assertEquals(agents.get('again')?.handoffFrom, undefined, 'an agent under an agent of the same name is not a handoff');
  assertEquals(agents.get('llm3')?.name, 'coordinator', 'span under the nested same-name agent');
  assertEquals(agents.get('coord')?.colorIndex, agents.get('llm3')?.colorIndex, 'one name has one color index');
  assertEquals(agents.get('coord')?.colorIndex === agents.get('planner')?.colorIndex, false, 'different agents get different color indexes');
  assertEquals(agents.get('coord')?.colorIndex, 0, 'color indexes follow first appearance, starting at 0');
  assertEquals(agents.get('planner')?.colorIndex, 1, 'second agent gets index 1');

  const second = getSpanAgents([root]);
  assertEquals(second.get('planner')?.colorIndex, agents.get('planner')?.colorIndex, 'the same trace gives the same color indexes every time');
});

describe('agent ownership - unnamed agent spans and several roots', () => {
  const a = makeSpan('a', null, [kind('AGENT')], 'research loop');
  makeSpan('b', a, [kind('LLM')]);
  const other = makeSpan('other', null, agentTags('writer'));
  const agents = getSpanAgents([a, other]);
  assertEquals(agents.get('a')?.name, 'research loop', 'an agent span without a name attribute is named after its span');
  assertEquals(agents.get('b')?.name, 'research loop', 'its children belong to it');
  assertEquals(agents.get('other')?.handoffFrom, undefined, 'a second root agent is not handed off from the first');
  assertEquals(getSpanAgents([]).size, 0, 'an empty trace has no agents');
});

describe('agent ownership - agent names of framework conventions', () => {
  const pydantic = makeSpan('pyd', null, [{ key: 'agent_name', value: 'joke_agent' }, { key: 'pydantic_ai.all_messages', value: '[]' }], 'agent run');
  const pydanticTool = makeSpan('pyd-tool', pydantic, [{ key: 'tool_arguments', value: '{}' }], 'running tool');
  const traceloop = makeSpan('tl', null, [{ key: 'traceloop.span.kind', value: 'agent' }, { key: 'traceloop.entity.name', value: 'travel_agent' }], 'travel_agent.agent');
  const traceloopTool = makeSpan('tl-tool', traceloop, [{ key: 'traceloop.span.kind', value: 'tool' }, { key: 'traceloop.entity.name', value: 'lookup' }], 'lookup.tool');
  const langfuse = makeSpan('lf', null, [{ key: 'langfuse.observation.type', value: 'agent' }], 'support-bot');
  const mlflow = makeSpan('ml', null, [{ key: 'mlflow.spanType', value: '"AGENT"' }], 'qa_agent');
  const agents = getSpanAgents([pydantic, traceloop, langfuse, mlflow]);
  assertEquals(agents.get('pyd')?.name, 'joke_agent', 'a Pydantic AI agent span is named by agent_name');
  assertEquals(agents.get(pydanticTool.spanId)?.name, 'joke_agent', 'its tool span belongs to it');
  assertEquals(agents.get('tl')?.name, 'travel_agent', 'a Traceloop agent span is named by traceloop.entity.name');
  assertEquals(agents.get(traceloopTool.spanId)?.name, 'travel_agent', 'its tool span belongs to the agent, not to the tool entity name');
  assertEquals(agents.get('lf')?.name, 'support-bot', 'a Langfuse agent observation is named after its span');
  assertEquals(agents.get('ml')?.name, 'qa_agent', 'an MLflow agent span is named after its span');
});

describe('agent ownership - declared graph parent', () => {
  const graphTags = (id: string, parentId?: string, name?: string) => [
    kind('AGENT'),
    { key: 'graph.node.id', value: id },
    ...(parentId ? [{ key: 'graph.node.parent_id', value: parentId }] : []),
    ...(name ? [{ key: 'graph.node.name', value: name }] : []),
  ];
  // root
  //   router        (graph node "router")
  //     billing     (declared parent "triage", which is not an ancestor)
  //     refunds     (declared parent "gone", which no span declares)
  //     self        (declared parent is itself)
  //     support     (declared parent "router", the same agent that holds it)
  //   triage        (graph node "triage", named "Triage desk")
  //     (billing is declared below it, but nested under router)
  const root = makeSpan('root', null, [kind('CHAIN')]);
  const router = makeSpan('router', root, graphTags('router'), 'router');
  const billing = makeSpan('billing', router, graphTags('billing', 'triage'), 'billing');
  const refunds = makeSpan('refunds', router, graphTags('refunds', 'gone'), 'refunds');
  const self = makeSpan('self', router, graphTags('self', 'self'), 'self');
  const support = makeSpan('support', router, graphTags('support', 'router'), 'support');
  makeSpan('triage', root, graphTags('triage', undefined, 'Triage desk'), 'triage');
  const agents = getSpanAgents([root]);

  assertEquals(agents.get(billing.spanId)?.handoffFrom, 'Triage desk', 'a declared parent that is not an ancestor wins over nesting, by its graph name');
  assertEquals(agents.get(refunds.spanId)?.handoffFrom, 'router', 'a declared parent that no span declares falls back to the nesting');
  assertEquals(agents.get(self.spanId)?.handoffFrom, 'router', 'a node declared as its own parent falls back to the nesting');
  assertEquals(agents.get(support.spanId)?.handoffFrom, 'router', 'a declared parent equal to the nesting parent says the same');
  assertEquals(agents.get(router.spanId)?.handoffFrom, undefined, 'a node without a declared parent keeps the nesting rule');

  const later = makeSpan('later', null, [kind('CHAIN')]);
  const first = makeSpan('first', later, graphTags('first', 'second'), 'first');
  makeSpan('second', later, agentTags('second'), 'second');
  makeSpan('second-node', later, graphTags('second'), 'second');
  assertEquals(getSpanAgents([later]).get(first.spanId)?.handoffFrom, 'second', 'a declared parent may appear after the node that names it');

  const sameName = makeSpan('same-name', null, graphTags('worker', 'planner'), 'worker');
  makeSpan('planner-node', null, [kind('AGENT'), { key: 'graph.node.id', value: 'planner' }, { key: 'graph.node.name', value: 'worker' }], 'planner');
  assertEquals(getSpanAgents([sameName]).get(sameName.spanId)?.handoffFrom, undefined, 'a declared parent that reads the same as the agent is not a handoff');
});

describe('agent ownership - 5,000-level chain of agents', () => {
  const chain: PluginSpan[] = [];
  for (let i = 0; i < 5000; i++) {
    chain.push(makeSpan(`c${i}`, i === 0 ? null : chain[i - 1], agentTags(`agent ${i % 3}`)));
  }
  const agents = getSpanAgents([chain[0]]);
  assertEquals(agents.size, 5000, 'every span of a deep chain is visited');
  assertEquals(agents.get('c4999')?.handoffFrom, 'agent 0', 'the deepest agent knows its parent agent');
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) { process.exit(1); }

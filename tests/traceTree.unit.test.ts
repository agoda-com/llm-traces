// Unit tests for traceTree.ts (tree walks and collapse state)
// Run with: node --experimental-strip-types tests/traceTree.unit.test.ts

import {
  collapseOneLevel,
  expandOneLevel,
  getAncestorIds,
  getParentSpanIds,
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

function makeSpan(spanId: string, parent: PluginSpan | null): PluginSpan {
  const span: PluginSpan = {
    traceId: 't',
    spanId,
    parentSpanId: parent ? parent.spanId : null,
    operationName: spanId,
    serviceName: 'svc',
    serviceAttributes: [],
    startTimeMs: 0,
    durationMs: 1,
    tags: [],
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

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) { process.exit(1); }

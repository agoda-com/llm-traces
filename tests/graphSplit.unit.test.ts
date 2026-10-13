// Unit tests for graphSplit.ts (share of the list column that the span tree takes, and its persistence)
// Run with: node --experimental-strip-types tests/graphSplit.unit.test.ts

import {
  GRAPH_SPLIT_DEFAULT,
  GRAPH_SPLIT_MAX,
  GRAPH_SPLIT_MIN,
  clampGraphSplit,
  loadGraphSplit,
  saveGraphSplit,
} from '../src/utils/graphSplit.ts';

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

function describe(name: string, fn: () => void): void {
  console.log(`\n=== ${name} ===`);
  fn();
}

function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => { data[key] = value; },
  };
}

const throwingStorage = {
  getItem: (): string | null => { throw new Error('storage disabled'); },
  setItem: (): void => { throw new Error('storage disabled'); },
};

describe('limits', () => {
  assertEquals(GRAPH_SPLIT_DEFAULT, 0.5, 'the tree and the graph start with half each');
  assertEquals(GRAPH_SPLIT_MIN, 0.2, 'the tree keeps at least a fifth');
  assertEquals(GRAPH_SPLIT_MAX, 0.8, 'the graph keeps at least a fifth');
});

describe('clampGraphSplit', () => {
  assertEquals(clampGraphSplit(0.65), 0.65, 'a value inside the range is kept');
  assertEquals(clampGraphSplit(0.05), 0.2, 'below the minimum is raised');
  assertEquals(clampGraphSplit(1), 0.8, 'above the maximum is lowered');
  assertEquals(clampGraphSplit(Number.NaN), 0.5, 'NaN falls back to the default');
  assertEquals(clampGraphSplit(Number.POSITIVE_INFINITY), 0.5, 'infinity falls back to the default');
});

describe('loadGraphSplit', () => {
  assertEquals(loadGraphSplit(fakeStorage()), 0.5, 'nothing stored gives the default');
  const stored = fakeStorage();
  saveGraphSplit(0.7, stored);
  assertEquals(loadGraphSplit(stored), 0.7, 'a saved value is loaded back');
  saveGraphSplit(7, stored);
  assertEquals(loadGraphSplit(stored), 0.8, 'a saved value outside the range is clamped on load');
  const key = Object.keys(stored.data)[0];
  assertEquals(loadGraphSplit(fakeStorage({ [key]: 'tall' })), 0.5, 'garbage gives the default');
  assertEquals(loadGraphSplit(throwingStorage), 0.5, 'unavailable storage gives the default');
  assertEquals(loadGraphSplit(null), 0.5, 'missing storage gives the default');
});

describe('saveGraphSplit', () => {
  const stored = fakeStorage();
  saveGraphSplit(0.3, stored);
  assertEquals(Object.values(stored.data)[0], '0.3', 'the fraction is stored as text');
  assertEquals(Object.keys(stored.data)[0], 'agoda-llmtraces-app.graphSplitFraction', 'under a key of its own');
  saveGraphSplit(0.3, throwingStorage);
  saveGraphSplit(0.3, null);
  assertEquals(true, true, 'unavailable or missing storage does not throw');
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) { process.exit(1); }

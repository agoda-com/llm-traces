// Unit tests for the range maths in useVirtualList.ts
// Run with: node --experimental-strip-types tests/virtualList.unit.test.ts

import { coversView, getRenderRange, getViewRange } from '../src/utils/useVirtualList.ts';

let passed = 0;
let failed = 0;

function assertDeepEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`  FAIL: ${message} - expected ${e}, got ${a}`);
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

describe('getViewRange', () => {
  assertDeepEquals(getViewRange(0, 360, 36, 1000), { first: 0, last: 9 }, 'top of the list');
  assertDeepEquals(getViewRange(3600, 360, 36, 1000), { first: 100, last: 109 }, 'row-aligned scroll position');
  assertDeepEquals(getViewRange(50, 100, 36, 1000), { first: 1, last: 4 }, 'partly visible rows at both edges count');
  assertDeepEquals(getViewRange(0, 360, 36, 4), { first: 0, last: 3 }, 'short list: last row is clamped');
  assertDeepEquals(getViewRange(1_000_000, 360, 36, 100), { first: 99, last: 99 }, 'scrolled past the end: clamped to the last row');
  assertDeepEquals(getViewRange(-200, 360, 36, 100), { first: 0, last: 4 }, 'list starts below the top of the view');
  assertDeepEquals(getViewRange(0, 360, 36, 0), { first: 0, last: -1 }, 'empty list');
});

describe('getRenderRange', () => {
  assertDeepEquals(getRenderRange(100, 109, 1000, 33), { start: 67, end: 142 }, 'buffer on both sides');
  assertDeepEquals(getRenderRange(0, 9, 1000, 33), { start: 0, end: 42 }, 'buffer is cut at the start');
  assertDeepEquals(getRenderRange(990, 999, 1000, 33), { start: 957, end: 999 }, 'buffer is cut at the end');
  assertDeepEquals(getRenderRange(0, -1, 0, 33), { start: 0, end: -1 }, 'empty list');
});

describe('coversView', () => {
  const rendered = { start: 67, end: 142 };
  assertDeepEquals(coversView(rendered, 100, 109, 1000, 10), true, 'view well inside the rendered rows');
  assertDeepEquals(coversView(rendered, 77, 109, 1000, 10), true, 'view exactly one margin from the rendered start');
  assertDeepEquals(coversView(rendered, 76, 109, 1000, 10), false, 'view closer than the margin to the rendered start');
  assertDeepEquals(coversView(rendered, 100, 133, 1000, 10), false, 'view closer than the margin to the rendered end');
  assertDeepEquals(coversView({ start: 0, end: 42 }, 0, 9, 1000, 10), true, 'start of the list needs no rows above');
  assertDeepEquals(coversView({ start: 957, end: 999 }, 990, 999, 1000, 10), true, 'end of the list needs no rows below');
  assertDeepEquals(coversView({ start: 0, end: 9 }, 0, 30, 1000, 10), false, 'list grew below the rendered rows');
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) { process.exit(1); }

// Unit tests for formatUtils.ts
// Run with: node --experimental-strip-types tests/formatUtils.unit.test.ts

import { formatCompactArray } from '../src/utils/formatUtils.ts';

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

describe('formatCompactArray', () => {
  assertEquals(
    formatCompactArray(['summary', 'status', 'description']),
    '["summary", "status", "description"]',
    'joins short string items on one line with ", " separators',
  );
  assertEquals(formatCompactArray([1, 2.5, true, null, 'a']), '[1, 2.5, true, null, "a"]', 'accepts every primitive type');
  assertEquals(formatCompactArray([]), '[]', 'renders an empty array');
  assertEquals(formatCompactArray(['a', { b: 1 }]), undefined, 'rejects arrays containing objects');
  assertEquals(formatCompactArray([['a']]), undefined, 'rejects arrays containing arrays');
  assertEquals(formatCompactArray({ a: 1 }), undefined, 'rejects objects');
  assertEquals(formatCompactArray('["a"]'), undefined, 'rejects strings');
  assertEquals(formatCompactArray(['x'.repeat(100)]), undefined, 'rejects arrays longer than the line limit');
  assertEquals(formatCompactArray(Array.from({ length: 20 }, (_, i) => `item${i}`)), undefined, 'rejects long arrays of short items');
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) { process.exit(1); }

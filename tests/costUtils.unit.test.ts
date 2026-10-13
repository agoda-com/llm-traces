// Unit tests for costUtils.ts
// Run with: node --experimental-strip-types tests/costUtils.unit.test.ts

import { estimateCost, estimateCostDetailed, formatCost } from '../src/utils/costUtils.ts';

// ---------------------------------------------------------------------------
// Minimal assertion helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    failed++;
  } else {
    console.log(`  pass: ${message}`);
    passed++;
  }
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    console.error(`  FAIL: ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BUG-004: estimateCost substring boundary matching', () => {
  // Unrelated model name containing "o3" as an internal substring should NOT match
  assertEquals(
    estimateCost('my-recommender-o3-agent', 1000, 1000),
    undefined,
    '"my-recommender-o3-agent" does not false-positive on "o3" key',
  );

  // Unrelated model name containing "o1" as an internal substring should NOT match
  assertEquals(
    estimateCost('custom-o1-fine-tuned', 1000, 1000),
    undefined,
    '"custom-o1-fine-tuned" does not false-positive on "o1" key',
  );

  // Unrelated model name containing "command" as an internal substring should NOT match
  assertEquals(
    estimateCost('my-recommender-command-agent', 1000, 1000),
    undefined,
    '"my-recommender-command-agent" does not false-positive on "command" key',
  );

  // Exact key "o3" at start of string should still match
  assert(
    estimateCost('o3', 1_000_000, 0) !== undefined,
    '"o3" exact match resolves to a cost',
  );

  // "o3-mini" should match "o3-mini" key, not "o3"
  const o3miniCost = estimateCost('o3-mini', 1_000_000, 0);
  assert(o3miniCost !== undefined, '"o3-mini" resolves to a cost');
  // o3-mini input price is $1.1/M tokens; o3 input price is $2/M — they must differ
  const o3Cost = estimateCost('o3', 1_000_000, 0);
  assert(
    o3miniCost !== o3Cost,
    '"o3-mini" uses o3-mini pricing, not o3 pricing',
  );

  // "gpt-4o-mini" should match "gpt-4o-mini" (longer key wins over "gpt-4o")
  const gpt4oMiniCost = estimateCost('gpt-4o-mini', 1_000_000, 0);
  const gpt4oCost = estimateCost('gpt-4o', 1_000_000, 0);
  assert(gpt4oMiniCost !== undefined, '"gpt-4o-mini" resolves to a cost');
  assert(
    gpt4oMiniCost !== gpt4oCost,
    '"gpt-4o-mini" uses gpt-4o-mini pricing, not gpt-4o pricing',
  );

  // Model with "o3" at word boundary via separator should match
  assert(
    estimateCost('openai/o3', 1_000_000, 0) !== undefined,
    '"openai/o3" with separator before "o3" resolves to a cost',
  );
});

describe('BUG-009: estimateCost undefined/null guards', () => {
  // Both undefined → undefined
  assertEquals(
    estimateCost('gpt-4o', undefined, undefined),
    undefined,
    'both tokens undefined returns undefined',
  );

  // null treated as undefined — both null → undefined
  assertEquals(
    estimateCost('gpt-4o', null as unknown as number, null as unknown as number),
    undefined,
    'both tokens null returns undefined',
  );

  // null input with defined output → estimate using output only (safeInput treated as 0)
  assert(
    estimateCost('gpt-4o', null as unknown as number, 1000) !== undefined,
    'null input with defined output returns a cost estimate',
  );

  // Legitimate zero cost: (0, 0) → defined value of 0
  assertEquals(
    estimateCost('gpt-4o', 0, 0),
    0,
    '(0, 0) tokens returns 0 (legitimate zero cost)',
  );

  // Only input defined → cost is based on input only
  const inputOnlyCost = estimateCost('gpt-4o', 1_000_000, undefined);
  assert(inputOnlyCost !== undefined, 'defined input + undefined output returns a cost');
  assertEquals(
    inputOnlyCost,
    2.5, // gpt-4o: $2.5/M input tokens
    'gpt-4o with 1M input tokens and undefined output costs $2.50',
  );

  // Only output defined → cost is based on output only
  const outputOnlyCost = estimateCost('gpt-4o', undefined, 1_000_000);
  assert(outputOnlyCost !== undefined, 'undefined input + defined output returns a cost');
  assertEquals(
    outputOnlyCost,
    10, // gpt-4o: $10/M output tokens
    'gpt-4o with undefined input and 1M output tokens costs $10.00',
  );
});

describe('BUG-010: formatCost negative values', () => {
  // Negative value should produce "-$..." not "$-..."
  assertEquals(
    formatCost(-0.05),
    '-$0.050',
    'formatCost(-0.05) returns "-$0.050"',
  );

  assertEquals(
    formatCost(-5),
    '-$5.00',
    'formatCost(-5) returns "-$5.00"',
  );

  assertEquals(
    formatCost(-0.001),
    '-$0.0010',
    'formatCost(-0.001) returns "-$0.0010"',
  );

  assertEquals(
    formatCost(-0.00001),
    '-<$0.0001',
    'formatCost(-0.00001) returns "-<$0.0001"',
  );

  // Positive values remain unaffected
  assertEquals(formatCost(0), '$0', 'formatCost(0) still returns "$0"');
  assertEquals(formatCost(5), '$5.00', 'formatCost(5) still returns "$5.00"');
  assertEquals(formatCost(0.05), '$0.050', 'formatCost(0.05) still returns "$0.050"');
});

// ---------------------------------------------------------------------------
// Cache-aware pricing
// ---------------------------------------------------------------------------

describe('estimateCostDetailed - cached tokens are priced once', () => {
  // claude-sonnet-4-5: input 3, output 15, cache read 0.3, cache write 3.75 (USD per 1M tokens).
  // Input tokens include the cached ones: 1000 = 200 uncached + 600 read + 200 written.
  const cached = estimateCostDetailed('claude-sonnet-4-5', { input: 1000, output: 100, cacheRead: 600, cacheWrite: 200 });
  const expected = (200 * 3 + 600 * 0.3 + 200 * 3.75 + 100 * 15) / 1_000_000;
  assert(cached !== undefined && Math.abs(cached.usd - expected) < 1e-12, 'uncached input, cache read, cache write and output are each priced once');
  assertEquals(cached?.approximate, false, 'exact when the table has both cache prices');

  const uncachedOnly = estimateCostDetailed('claude-sonnet-4-5', { input: 1000, output: 100 });
  assert(uncachedOnly !== undefined && Math.abs(uncachedOnly.usd - (1000 * 3 + 100 * 15) / 1_000_000) < 1e-12, 'without cache tokens the price is input times rate plus output times rate');
  assertEquals(uncachedOnly?.approximate, false, 'nothing is approximate without cache tokens');

  const openAi = estimateCostDetailed('gpt-4o', { input: 1000, output: 0, cacheRead: 400 });
  assert(openAi !== undefined && Math.abs(openAi.usd - (600 * 2.5 + 400 * 1.25) / 1_000_000) < 1e-12, 'OpenAI cached input uses the cache read price');
  assertEquals(openAi?.approximate, false, 'a read price is enough when only reads are present');
});

describe('estimateCostDetailed - models without cache prices', () => {
  // gemini-2.0-flash has no cache price in the table: cached tokens are priced at the input rate.
  const result = estimateCostDetailed('gemini-2.0-flash', { input: 1000, output: 100, cacheRead: 500 });
  assert(result !== undefined && Math.abs(result.usd - (1000 * 0.1 + 100 * 0.4) / 1_000_000) < 1e-12, 'cache read is priced at the input rate, so the total equals the plain price');
  assertEquals(result?.approximate, true, 'marked as an estimate');

  const writeOnly = estimateCostDetailed('gpt-4o', { input: 1000, output: 0, cacheWrite: 300 });
  assertEquals(writeOnly?.approximate, true, 'cache writes without a write price are an estimate');
});

describe('estimateCostDetailed - edge cases', () => {
  const overlap = estimateCostDetailed('claude-sonnet-4-5', { input: 100, output: 0, cacheRead: 500 });
  assert(overlap !== undefined && Math.abs(overlap.usd - (500 * 0.3) / 1_000_000) < 1e-12, 'uncached input never goes negative when the cache counts exceed the input');
  assertEquals(estimateCostDetailed('no-such-model', { input: 10, output: 10 }), undefined, 'unknown model');
  assertEquals(estimateCostDetailed('gpt-4o', {}), undefined, 'no tokens');
});

describe('estimateCost - cache aware and backward compatible', () => {
  assertEquals(estimateCost('gpt-4o', 1000, 100), (1000 * 2.5 + 100 * 10) / 1_000_000, 'two-argument form is unchanged');
  const withCache = estimateCost('gpt-4o', 1000, 100, { cacheRead: 400 });
  assert(withCache !== undefined && Math.abs(withCache - (600 * 2.5 + 400 * 1.25 + 100 * 10) / 1_000_000) < 1e-12, 'optional cache argument');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) { process.exit(1); }

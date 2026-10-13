// Unit tests for OTLP attribute and scope parsing in tempoClient.ts
// Run with: node --import ./tests/node-loader.mjs --experimental-strip-types tests/otlpParse.unit.test.ts

import { parseOtlpTrace, flattenTree } from '../src/utils/tempoClient.ts';
import { formatAttributeValue } from '../src/utils/formatUtils.ts';
import { extractLlmSpanData, detectFramework } from '../src/utils/llmUtils.ts';

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
    console.error(`  FAIL: ${message} - expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed++;
  } else {
    console.log(`  pass: ${message}`);
    passed++;
  }
}

function assertDeepEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    console.error(`  FAIL: ${message}\n    expected: ${b}\n    got:      ${a}`);
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

type Attr = { key: string; value: Record<string, unknown> };

function span(attributes: Attr[], events: Array<{ name: string; attributes: Attr[] }> = []) {
  return {
    traceId: 't1',
    spanId: 's1',
    name: 'op',
    startTimeUnixNano: '1000000000',
    endTimeUnixNano: '2000000000',
    attributes,
    events: events.map((event) => ({ timeUnixNano: '1500000000', ...event })),
  };
}

function parseSingle(attributes: Attr[], events: Array<{ name: string; attributes: Attr[] }> = []) {
  const spans = flattenTree(parseOtlpTrace({ resourceSpans: [{ scopeSpans: [{ spans: [span(attributes, events)] }] }] }));
  return spans[0];
}

const str = (v: string) => ({ stringValue: v });
const int = (v: number) => ({ intValue: String(v) });

describe('scalar attributes are unchanged', () => {
  const parsed = parseSingle([
    { key: 'a', value: str('x') },
    { key: 'b', value: int(7) },
    { key: 'c', value: { doubleValue: 0.5 } },
    { key: 'd', value: { boolValue: true } },
  ]);
  assertDeepEquals(parsed.tags.map((t) => t.value), ['x', 7, 0.5, true], 'string, int, double and bool values');
});

describe('array attribute values stay arrays', () => {
  const parsed = parseSingle([
    { key: 'strings', value: { arrayValue: { values: [str('a'), str('b')] } } },
    { key: 'numbers', value: { arrayValue: { values: [int(1), { doubleValue: 2.5 }] } } },
    { key: 'empty', value: { arrayValue: { values: [] } } },
    { key: 'nested', value: { arrayValue: { values: [{ arrayValue: { values: [str('x')] } }] } } },
    { key: 'objects', value: { arrayValue: { values: [{ kvlistValue: { values: [{ key: 'role', value: str('user') }] } }] } } },
  ]);
  const byKey = Object.fromEntries(parsed.tags.map((t) => [t.key, t.value]));
  assertDeepEquals(byKey.strings, ['a', 'b'], 'string array');
  assertDeepEquals(byKey.numbers, [1, 2.5], 'number array');
  assertDeepEquals(byKey.empty, [], 'empty array');
  assertDeepEquals(byKey.nested, [['x']], 'nested array');
  assertDeepEquals(byKey.objects, [{ role: 'user' }], 'array of key-value lists becomes an array of objects');
});

describe('key-value list attribute values become objects', () => {
  const parsed = parseSingle([
    {
      key: 'config',
      value: {
        kvlistValue: {
          values: [
            { key: 'name', value: str('n') },
            { key: 'size', value: int(3) },
            { key: 'tags', value: { arrayValue: { values: [str('t1')] } } },
            { key: 'inner', value: { kvlistValue: { values: [{ key: 'k', value: { boolValue: false } }] } } },
          ],
        },
      },
    },
    { key: 'emptyList', value: { kvlistValue: { values: [] } } },
  ]);
  assertDeepEquals(parsed.tags[0].value, { name: 'n', size: 3, tags: ['t1'], inner: { k: false } }, 'nested key-value list');
  assertDeepEquals(parsed.tags[1].value, {}, 'empty key-value list');
});

describe('event attributes keep structured values too', () => {
  const parsed = parseSingle([], [{ name: 'e', attributes: [{ key: 'tool_calls', value: { arrayValue: { values: [{ kvlistValue: { values: [{ key: 'id', value: str('call_1') }] } }] } } }] }]);
  assertDeepEquals(parsed.logs[0].fields[0].value, [{ id: 'call_1' }], 'event array of objects');
});

describe('instrumentation scope', () => {
  const current = flattenTree(parseOtlpTrace({
    resourceSpans: [{ scopeSpans: [{ scope: { name: 'ai', version: '5.0.1' }, spans: [span([])] }] }],
  }))[0];
  assertEquals(current.scopeName, 'ai', 'scope name from scopeSpans[].scope');
  assertEquals(current.scopeVersion, '5.0.1', 'scope version from scopeSpans[].scope');

  const legacy = flattenTree(parseOtlpTrace({
    resourceSpans: [{ instrumentationLibrarySpans: [{ instrumentationLibrary: { name: 'old-lib', version: '0.9' }, spans: [span([])] }] }],
  }))[0];
  assertEquals(legacy.scopeName, 'old-lib', 'scope name from instrumentationLibrarySpans[].instrumentationLibrary');
  assertEquals(legacy.scopeVersion, '0.9', 'scope version from the legacy field');

  const none = flattenTree(parseOtlpTrace({ resourceSpans: [{ scopeSpans: [{ spans: [span([])] }] }] }))[0];
  assertEquals(none.scopeName, undefined, 'no scope name when the exporter sends none');
  assert(!('scopeVersion' in none), 'no scopeVersion key when absent');

  const emptyScope = flattenTree(parseOtlpTrace({ resourceSpans: [{ scopeSpans: [{ scope: { name: '', version: '' }, spans: [span([])] }] }] }))[0];
  assertEquals(emptyScope.scopeName, undefined, 'empty scope name is treated as absent');
});

describe('formatAttributeValue keeps the previous display text', () => {
  assertEquals(formatAttributeValue('plain'), 'plain', 'string');
  assertEquals(formatAttributeValue(42), '42', 'number');
  assertEquals(formatAttributeValue(true), 'true', 'boolean');
  assertEquals(formatAttributeValue(['a', 'b']), 'a, b', 'array is comma separated');
  assertEquals(formatAttributeValue([1, 2.5, false]), '1, 2.5, false', 'array of scalars');
  assertEquals(formatAttributeValue([]), '', 'empty array');
  assertEquals(formatAttributeValue({ a: 1, b: 'x' }), 'a=1, b=x', 'object is key=value pairs');
  assertEquals(formatAttributeValue({ a: ['p', 'q'], b: { c: 1 } }), 'a=p, q, b=c=1', 'nested values use the same format');
  assertEquals(formatAttributeValue({}), '', 'empty object');
  assertEquals(formatAttributeValue(null), '', 'null');
  assertEquals(formatAttributeValue([['x']]), '["x"]', 'nested arrays have no earlier text and fall back to JSON');
});

describe('LLM extraction accepts structured attribute values', () => {
  const nativeMessages = extractLlmSpanData([
    { key: 'gen_ai.operation.name', value: 'chat' },
    { key: 'gen_ai.input.messages', value: [{ role: 'user', parts: [{ type: 'text', content: 'hello' }] }] },
    { key: 'gen_ai.output.messages', value: [{ role: 'assistant', parts: [{ type: 'text', content: 'hi' }] }] },
    { key: 'gen_ai.response.finish_reasons', value: ['stop'] },
    { key: 'gen_ai.tool.definitions', value: [{ type: 'function', name: 'f', description: 'd', parameters: {} }] },
  ], []);
  assertEquals(nativeMessages.inputMessages[0]?.content, 'hello', 'native array input messages');
  assertEquals(nativeMessages.outputMessages[0]?.content, 'hi', 'native array output messages');
  assertEquals(nativeMessages.finishReason, 'stop', 'finish reasons array');
  assertEquals(nativeMessages.tools[0]?.name, 'f', 'native tool definitions');
});

describe('scope-based framework detection', () => {
  assertEquals(detectFramework([], { name: 'ai' }), 'vercel-ai', 'scope ai is the Vercel AI SDK');
  assertEquals(detectFramework([], { name: 'pydantic-ai' }), 'pydantic-ai', 'scope pydantic-ai');
  assertEquals(detectFramework([], { name: 'langfuse-sdk' }), 'langfuse', 'scope langfuse-sdk');
  assertEquals(detectFramework([], { name: 'something-else' }), undefined, 'unknown scope');
  assertEquals(detectFramework([], undefined), undefined, 'no scope, no attributes');
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

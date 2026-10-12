// Unit tests for LLM-tracing conventions beyond OpenInference and the basic OTel GenAI attributes.
// Run with: node --experimental-strip-types tests/llmConventions.unit.test.ts
// Attribute shapes are modelled on public OTel GenAI semantic conventions and framework traces;
// all content is synthetic.

import {
  extractLlmSpanData,
  getLlmDisplayAttributeKeys,
  type KeyValuePair,
  type SpanLog,
} from '../src/utils/llmUtils.ts';

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

function kv(key: string, value: unknown): KeyValuePair {
  return { key, value };
}

function log(name: string, fields: KeyValuePair[], timestamp = 0): SpanLog {
  return { timestamp, name, fields };
}

// ---------------------------------------------------------------------------
// Area 1: OTel GenAI events and the newest semantic conventions
// ---------------------------------------------------------------------------

describe('GenAI events: system, user and choice with spec attribute names', () => {
  const tags = [kv('gen_ai.response.model', 'model-a')];
  const logs = [
    log('gen_ai.system.message', [kv('content', 'You are a helpful assistant.')]),
    log('gen_ai.user.message', [kv('content', 'What is the capital of France?')]),
    log('gen_ai.choice', [
      kv('index', 0),
      kv('finish_reason', 'stop'),
      kv('message', JSON.stringify({ role: 'assistant', content: 'The capital of France is Paris.' })),
    ]),
  ];
  const result = extractLlmSpanData(tags, logs);
  assertEquals(result.convention, 'otel-genai', 'convention is otel-genai');
  assertDeepEquals(result.inputMessages.map((m) => [m.role, m.content]), [
    ['system', 'You are a helpful assistant.'],
    ['user', 'What is the capital of France?'],
  ], 'system and user content read from the content attribute');
  assertDeepEquals(result.outputMessages.map((m) => [m.role, m.content]), [
    ['assistant', 'The capital of France is Paris.'],
  ], 'choice message JSON becomes the assistant output');
  assertEquals(result.finishReason, 'stop', 'finish_reason of the choice event is the finish reason');
});

describe('GenAI events: choice message given as a structured object', () => {
  const logs = [
    log('gen_ai.choice', [
      kv('index', 0),
      kv('finish_reason', 'tool_calls'),
      kv('message', { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } }] }),
    ]),
  ];
  const result = extractLlmSpanData([kv('gen_ai.system', 'openai')], logs);
  assertEquals(result.outputMessages.length, 1, 'one output message');
  assertEquals(result.outputMessages[0].toolCalls?.[0].name, 'get_weather', 'tool call name from message.tool_calls');
  assertEquals(result.outputMessages[0].toolCalls?.[0].id, 'call_1', 'tool call id from message.tool_calls');
  assertEquals(result.finishReason, 'tool_calls', 'finish reason tool_calls');
});

describe('GenAI events: tool_calls on the choice event itself', () => {
  const logs = [
    log('gen_ai.choice', [
      kv('index', 0),
      kv('finish_reason', 'tool_calls'),
      kv('message', JSON.stringify({ role: 'assistant' })),
      kv('tool_calls', JSON.stringify([{ id: 'call_9', type: 'function', function: { name: 'lookup', arguments: '{"q":"x"}' } }])),
    ]),
  ];
  const result = extractLlmSpanData([kv('gen_ai.system', 'openai')], logs);
  assertEquals(result.outputMessages[0]?.toolCalls?.[0]?.name, 'lookup', 'top-level tool_calls attached to the output message');
});

describe('GenAI events: assistant tool call, tool message and final choice', () => {
  const logs = [
    log('gen_ai.user.message', [kv('content', 'Weather in Paris?')]),
    log('gen_ai.assistant.message', [
      kv('tool_calls', JSON.stringify([{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } }])),
    ]),
    log('gen_ai.tool.message', [kv('id', 'call_1'), kv('content', 'Sunny, 22C')]),
    log('gen_ai.choice', [kv('index', 0), kv('finish_reason', 'stop'), kv('message', JSON.stringify({ role: 'assistant', content: 'It is sunny.' }))]),
  ];
  const result = extractLlmSpanData([kv('gen_ai.system', 'openai')], logs);
  assertDeepEquals(result.inputMessages.map((m) => m.role), ['user', 'assistant', 'tool'], 'assistant and tool messages are part of the input history in event order');
  assertEquals(result.inputMessages[1].toolCalls?.[0].name, 'get_weather', 'assistant.message carries the tool call');
  assertEquals(result.inputMessages[2].toolCallId, 'call_1', 'tool.message id becomes the tool call id');
  const toolResult = result.inputMessages[2].parts?.find((p) => p.type === 'tool_result');
  assert(toolResult !== undefined && toolResult.type === 'tool_result' && toolResult.result === 'Sunny, 22C', 'tool.message content becomes a tool result part');
  assertEquals(result.outputMessages[0].content, 'It is sunny.', 'final answer is the output');
});

describe('GenAI events: the role attribute overrides the role implied by the event name', () => {
  const logs = [
    log('gen_ai.system.message', [kv('role', 'developer'), kv('content', 'Be brief.')]),
  ];
  const result = extractLlmSpanData([kv('gen_ai.system', 'openai')], logs);
  assertEquals(result.inputMessages[0].role, 'developer', 'explicit role wins');
});

describe('GenAI events: legacy gen_ai.content.prompt and gen_ai.content.completion are still read', () => {
  const logs = [
    log('gen_ai.content.prompt', [kv('gen_ai.prompt', 'Hello legacy')]),
    log('gen_ai.content.completion', [kv('gen_ai.completion', 'Hi legacy')]),
  ];
  const result = extractLlmSpanData([kv('gen_ai.system', 'openai')], logs);
  assertEquals(result.inputMessages[0].content, 'Hello legacy', 'legacy prompt');
  assertEquals(result.outputMessages[0].content, 'Hi legacy', 'legacy completion');
});

describe('gen_ai.client.inference.operation.details event', () => {
  const logs = [
    log('gen_ai.client.inference.operation.details', [
      kv('gen_ai.input.messages', JSON.stringify([{ role: 'user', parts: [{ type: 'text', content: 'What is the capital of France?' }] }])),
      kv('gen_ai.output.messages', JSON.stringify([{ role: 'assistant', parts: [{ type: 'text', content: 'Paris' }], finish_reason: 'stop' }])),
      kv('gen_ai.system_instructions', JSON.stringify([{ type: 'text', content: 'You are a geography tutor.' }])),
      kv('gen_ai.tool.definitions', JSON.stringify([{ type: 'function', name: 'get_capital', description: 'Look up a capital', parameters: { type: 'object', properties: {} } }])),
    ]),
  ];
  const result = extractLlmSpanData([kv('gen_ai.operation.name', 'chat'), kv('gen_ai.request.model', 'model-a')], logs);
  assertDeepEquals(result.inputMessages.map((m) => m.role), ['system', 'user'], 'system instructions are prepended as a system message');
  assertEquals(result.inputMessages[0].parts?.[0].type === 'text' ? result.inputMessages[0].parts[0].text : '', 'You are a geography tutor.', 'system text from instructions parts');
  assertEquals(result.outputMessages[0].role, 'assistant', 'output message from the event');
  assertEquals(result.outputMessages[0].parts?.[0].type === 'text' ? result.outputMessages[0].parts[0].text : '', 'Paris', 'output text');
  assertEquals(result.tools[0]?.name, 'get_capital', 'tool definitions from the event');
});

describe('gen_ai.client.inference.operation.details event: no system instructions', () => {
  const logs = [
    log('gen_ai.client.inference.operation.details', [
      kv('gen_ai.output.messages', JSON.stringify([{ role: 'assistant', parts: [{ type: 'text', content: 'Hello!' }], finish_reason: 'stop' }])),
    ]),
  ];
  const result = extractLlmSpanData([kv('gen_ai.operation.name', 'chat')], logs);
  assertEquals(result.inputMessages.length, 0, 'no input and no system message');
  assertEquals(result.outputMessages.length, 1, 'output only');
});

describe('gen_ai.system_instructions attribute', () => {
  const base = [
    kv('gen_ai.operation.name', 'chat'),
    kv('gen_ai.request.model', 'model-a'),
    kv('gen_ai.input.messages', JSON.stringify([{ role: 'user', parts: [{ type: 'text', content: 'hi' }] }])),
  ];
  const asString = extractLlmSpanData([...base, kv('gen_ai.system_instructions', 'Answer concisely.')], []);
  assertDeepEquals(asString.inputMessages.map((m) => [m.role, m.content]), [['system', 'Answer concisely.'], ['user', 'hi']], 'plain string instructions become a leading system message');

  const asParts = extractLlmSpanData([...base, kv('gen_ai.system_instructions', JSON.stringify([{ type: 'text', content: 'Part one.' }, { type: 'text', content: 'Part two.' }]))], []);
  assertEquals(asParts.inputMessages[0].role, 'system', 'parts instructions become a system message');
  assertDeepEquals(asParts.inputMessages[0].parts?.map((p) => (p.type === 'text' ? p.text : '')), ['Part one.', 'Part two.'], 'each instruction part is kept');

  const asNative = extractLlmSpanData([...base, kv('gen_ai.system_instructions', [{ type: 'text', content: 'Native parts.' }])], []);
  assertEquals(asNative.inputMessages[0].parts?.[0].type === 'text' ? asNative.inputMessages[0].parts[0].text : '', 'Native parts.', 'native array instructions are read');

  const withSystem = extractLlmSpanData([
    kv('gen_ai.operation.name', 'chat'),
    kv('gen_ai.input.messages', JSON.stringify([{ role: 'system', content: 'Existing system.' }, { role: 'user', content: 'hi' }])),
    kv('gen_ai.system_instructions', 'Duplicate?'),
  ], []);
  assertDeepEquals(withSystem.inputMessages.map((m) => m.content), ['Existing system.', 'hi'], 'instructions are not added when the input already has a system message');

  const keys = getLlmDisplayAttributeKeys([...base, kv('gen_ai.system_instructions', 'Answer concisely.')], asString);
  assert(keys.has('gen_ai.system_instructions'), 'gen_ai.system_instructions is promoted out of the raw attribute list');
});

describe('gen_ai.tool.definitions is still read from the span attribute', () => {
  const defs = JSON.stringify([{ type: 'function', name: 'search', description: 'Search', parameters: { type: 'object', properties: {} } }]);
  const result = extractLlmSpanData([kv('gen_ai.operation.name', 'chat'), kv('gen_ai.tool.definitions', defs)], []);
  assertEquals(result.tools[0]?.name, 'search', 'tool definition name');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

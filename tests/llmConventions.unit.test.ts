// Unit tests for LLM-tracing conventions beyond OpenInference and the basic OTel GenAI attributes.
// Run with: node --experimental-strip-types tests/llmConventions.unit.test.ts
// Attribute shapes are modelled on public OTel GenAI semantic conventions and framework traces;
// all content is synthetic.

import {
  extractLlmSpanData,
  getLlmDisplayAttributeKeys,
  getSpanDisplayName,
  getSpanKind,
  isEmbeddingSpan,
  isLlmSpan,
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
// Area 2: tool spans per OTel GenAI
// ---------------------------------------------------------------------------

describe('OTel GenAI execute_tool span', () => {
  const tags = [
    kv('gen_ai.operation.name', 'execute_tool'),
    kv('gen_ai.tool.name', 'get_weather'),
    kv('gen_ai.tool.call.id', 'call_1'),
    kv('gen_ai.tool.description', 'Get the weather for a city'),
    kv('gen_ai.tool.type', 'function'),
    kv('gen_ai.tool.call.arguments', '{"city":"Paris"}'),
    kv('gen_ai.tool.call.result', '{"temperature":21}'),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(getSpanKind(tags), 'TOOL', 'span kind is TOOL');
  assertEquals(result.inputMessages.length, 1, 'one input message for the call');
  assertEquals(result.inputMessages[0].role, 'assistant', 'the call is shown as an assistant tool call');
  assertEquals(result.inputMessages[0].toolCalls?.[0].name, 'get_weather', 'tool call name from gen_ai.tool.name');
  assertEquals(result.inputMessages[0].toolCalls?.[0].id, 'call_1', 'tool call id from gen_ai.tool.call.id');
  assertEquals(result.inputMessages[0].toolCalls?.[0].arguments, '{"city":"Paris"}', 'tool call arguments');
  assertEquals(result.outputMessages.length, 1, 'one output message for the result');
  const toolResult = result.outputMessages[0].parts?.[0];
  assert(toolResult?.type === 'tool_result' && toolResult.result === '{"temperature":21}', 'tool result part carries gen_ai.tool.call.result');
  assert(toolResult?.type === 'tool_result' && toolResult.toolCallId === 'call_1' && toolResult.name === 'get_weather', 'tool result is correlated by call id and name');
  assertEquals(result.tools[0]?.name, 'get_weather', 'tool definition synthesised from the tool attributes');
  assertEquals(result.tools[0]?.description, 'Get the weather for a city', 'tool description from gen_ai.tool.description');
  assertEquals(result.tools[0]?.type, 'function', 'tool type from gen_ai.tool.type');
  assert(!isLlmSpan(tags), 'a tool span is not counted as an LLM span');
  assertEquals(result.isLlm, false, 'a tool span is not a model call');
  const keys = getLlmDisplayAttributeKeys(tags, result);
  assert(keys.has('gen_ai.tool.call.arguments') && keys.has('gen_ai.tool.call.result') && keys.has('gen_ai.tool.description'), 'tool attributes are promoted out of the raw list');
});

describe('Tool spans are detected without an operation name', () => {
  assertEquals(getSpanKind([kv('gen_ai.tool.name', 'search')]), 'TOOL', 'gen_ai.tool.name alone marks a TOOL span');
  assertEquals(getSpanKind([kv('gen_ai.tool.call.id', 'call_7')]), 'TOOL', 'gen_ai.tool.call.id alone marks a TOOL span');
  assertEquals(getSpanKind([kv('gen_ai.operation.name', 'chat'), kv('gen_ai.request.model', 'm')]), 'LLM', 'chat spans stay LLM');
  assert(!isLlmSpan([kv('gen_ai.tool.name', 'search'), kv('gen_ai.system', 'example')]), 'tool span with gen_ai.system is not an LLM span');
});

describe('Tool span with structured arguments and result', () => {
  const tags = [
    kv('gen_ai.tool.name', 'lookup'),
    kv('gen_ai.tool.call.arguments', { query: 'x', limit: 2 }),
    kv('gen_ai.tool.call.result', [{ id: 1 }, { id: 2 }]),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.inputMessages[0].toolCalls?.[0].arguments, '{"query":"x","limit":2}', 'object arguments are serialised as JSON');
  const toolResult = result.outputMessages[0].parts?.[0];
  assert(toolResult?.type === 'tool_result' && toolResult.result === '[{"id":1},{"id":2}]', 'array result is serialised as JSON');
});

describe('Tool span with only a result', () => {
  const result = extractLlmSpanData([kv('gen_ai.tool.name', 'lookup'), kv('gen_ai.tool.call.result', 'done')], []);
  assertEquals(result.inputMessages.length, 0, 'no call card without arguments');
  assertEquals(result.outputMessages.length, 1, 'result card');
});

describe('Chat spans keep counting as model calls', () => {
  const result = extractLlmSpanData([kv('gen_ai.operation.name', 'chat'), kv('gen_ai.request.model', 'm'), kv('gen_ai.usage.input_tokens', 5)], []);
  assertEquals(result.isLlm, true, 'chat span isLlm');
});

// ---------------------------------------------------------------------------
// Area 4: Vercel AI SDK (instrumentation scope "ai")
// ---------------------------------------------------------------------------

const AI_SDK_TOOL = JSON.stringify({
  type: 'function',
  name: 'getWeather',
  description: 'Get the weather in a location',
  inputSchema: { type: 'object', properties: { location: { type: 'string' } }, required: ['location'] },
});

describe('Vercel AI SDK 5 model call (doGenerate)', () => {
  const messages = [
    { role: 'system', content: 'You help with weather.' },
    { role: 'user', content: [{ type: 'text', text: 'Weather in Paris?' }] },
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'call_a', toolName: 'getWeather', input: { location: 'Paris' } }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call_a', toolName: 'getWeather', output: { type: 'json', value: { temp: 21 } } }] },
  ];
  const tags = [
    kv('operation.name', 'ai.generateText.doGenerate'),
    kv('ai.operationId', 'ai.generateText.doGenerate'),
    kv('ai.model.id', 'model-a'),
    kv('ai.model.provider', 'example.chat'),
    kv('ai.prompt.messages', JSON.stringify(messages)),
    kv('ai.prompt.tools', [AI_SDK_TOOL]),
    kv('ai.prompt.toolChoice', '{"type":"auto"}'),
    kv('ai.settings.maxRetries', 2),
    kv('ai.response.text', 'It is 21 degrees.'),
    kv('ai.response.toolCalls', JSON.stringify([{ toolCallId: 'call_b', toolName: 'getWeather', input: '{"location":"Rome"}' }])),
    kv('ai.response.finishReason', 'tool-calls'),
    kv('ai.usage.inputTokens', 62),
    kv('ai.usage.outputTokens', 85),
    kv('gen_ai.system', 'example.chat'),
    kv('gen_ai.request.model', 'model-a'),
    kv('gen_ai.response.model', 'model-a-2025'),
  ];
  const result = extractLlmSpanData(tags, [], 'ai.generateText.doGenerate', { name: 'ai', version: '5.0.0' });
  assertEquals(result.framework, 'vercel-ai', 'framework vercel-ai');
  assertEquals(result.convention, 'otel-genai', 'convention otel-genai');
  assertEquals(getSpanKind(tags), 'LLM', 'span kind LLM');
  assertEquals(result.isLlm, true, 'counts as a model call');
  assertEquals(result.model, 'model-a-2025', 'gen_ai.response.model wins over ai.model.id');
  assertDeepEquals(result.inputMessages.map((m) => m.role), ['system', 'user', 'assistant', 'tool'], 'prompt messages');
  assertEquals(result.inputMessages[1].content, 'Weather in Paris?', 'text part');
  assertEquals(result.inputMessages[2].toolCalls?.[0].name, 'getWeather', 'assistant tool call name from toolName');
  assertEquals(result.inputMessages[2].toolCalls?.[0].id, 'call_a', 'assistant tool call id from toolCallId');
  assertEquals(result.inputMessages[2].toolCalls?.[0].arguments, '{"location":"Paris"}', 'assistant tool call arguments from input');
  const toolResult = result.inputMessages[3].parts?.[0];
  assert(toolResult?.type === 'tool_result' && toolResult.toolCallId === 'call_a' && toolResult.result !== undefined && JSON.stringify(toolResult.result) === '{"temp":21}', 'tool result value is unwrapped from output.value');
  assertEquals(result.outputMessages.length, 1, 'one output message');
  assertEquals(result.outputMessages[0].content, 'It is 21 degrees.', 'response text');
  assertEquals(result.outputMessages[0].toolCalls?.[0].arguments, '{"location":"Rome"}', 'response tool call arguments');
  assertEquals(result.tools[0]?.name, 'getWeather', 'tool definitions from ai.prompt.tools (array of JSON strings)');
  assertDeepEquals(Object.keys((result.tools[0]?.parameters as Record<string, unknown>) ?? {}), ['type', 'properties', 'required'], 'inputSchema is the tool parameters');
  assertEquals(result.tokenUsage.input, 62, 'input tokens from ai.usage.inputTokens');
  assertEquals(result.tokenUsage.output, 85, 'output tokens from ai.usage.outputTokens');
  assertEquals(result.finishReason, 'tool-calls', 'finish reason from ai.response.finishReason');
  assertEquals(result.system, 'example.chat', 'system from gen_ai.system');
  assertEquals((result.invocationParams as Record<string, unknown>).maxRetries, 2, 'ai.settings.maxRetries parameter');
  assertEquals((result.invocationParams as Record<string, unknown>).toolChoice, 'auto', 'tool choice parameter');
  const keys = getLlmDisplayAttributeKeys(tags, result);
  assert(keys.has('ai.prompt.messages') && keys.has('ai.response.text') && keys.has('ai.prompt.tools') && keys.has('ai.usage.inputTokens'), 'ai.* attributes shown above are promoted out of the raw list');
});

describe('Vercel AI SDK 4 model call (legacy attribute names)', () => {
  const tags = [
    kv('ai.operationId', 'ai.generateText.doGenerate'),
    kv('ai.model.id', 'model-b'),
    kv('ai.prompt.messages', JSON.stringify([
      { role: 'user', content: [{ type: 'text', text: 'Look it up' }] },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'lookup', args: { q: 'x' } }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'lookup', result: 'found' }] },
    ])),
    kv('ai.result.text', 'Done.'),
    kv('ai.result.toolCalls', JSON.stringify([{ toolCallId: 'c2', toolName: 'lookup', args: '{"q":"y"}' }])),
    kv('ai.usage.promptTokens', 30),
    kv('ai.usage.completionTokens', 10),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.framework, 'vercel-ai', 'detected without a scope from ai.operationId');
  assertEquals(result.model, 'model-b', 'model from ai.model.id');
  assertEquals(result.inputMessages[1].toolCalls?.[0].arguments, '{"q":"x"}', 'args in the assistant tool call');
  assert(result.inputMessages[2].parts?.[0].type === 'tool_result' && result.inputMessages[2].parts[0].result === 'found', 'result in the tool message');
  assertEquals(result.outputMessages[0].content, 'Done.', 'ai.result.text');
  assertEquals(result.outputMessages[0].toolCalls?.[0].arguments, '{"q":"y"}', 'ai.result.toolCalls args');
  assertEquals(result.tokenUsage.input, 30, 'ai.usage.promptTokens');
  assertEquals(result.tokenUsage.output, 10, 'ai.usage.completionTokens');
  assertEquals(result.tokenUsage.total, 40, 'total is input plus output when the SDK reports none');
});

describe('Vercel AI SDK operation ids map to span kinds', () => {
  const kind = (operationId: string) => getSpanKind([kv('ai.operationId', operationId)]);
  assertEquals(kind('ai.generateText.doGenerate'), 'LLM', 'generateText.doGenerate');
  assertEquals(kind('ai.streamText.doStream'), 'LLM', 'streamText.doStream');
  assertEquals(kind('ai.generateObject.doGenerate'), 'LLM', 'generateObject.doGenerate');
  assertEquals(kind('ai.streamObject.doStream'), 'LLM', 'streamObject.doStream');
  assertEquals(kind('ai.embed.doEmbed'), 'EMBEDDING', 'embed.doEmbed');
  assertEquals(kind('ai.embedMany.doEmbed'), 'EMBEDDING', 'embedMany.doEmbed');
  assertEquals(kind('ai.toolCall'), 'TOOL', 'toolCall');
  assertEquals(kind('ai.generateText'), 'CHAIN', 'generateText wrapper');
  assertEquals(kind('ai.streamText'), 'CHAIN', 'streamText wrapper');
  assertEquals(kind('ai.generateObject'), 'CHAIN', 'generateObject wrapper');
  assertEquals(getSpanKind([kv('operation.name', 'ai.streamText.doStream my-function')]), 'LLM', 'operation.name with a function id suffix');
  assertEquals(getSpanKind([kv('operation.name', 'chat completion')]), undefined, 'operation.name without the ai. prefix is not an AI SDK span');
});

describe('Vercel AI SDK wrapper span', () => {
  const tags = [
    kv('operation.name', 'ai.generateText my-function'),
    kv('ai.operationId', 'ai.generateText'),
    kv('ai.telemetry.functionId', 'my-function'),
    kv('ai.model.id', 'model-a'),
    kv('ai.prompt', JSON.stringify({ system: 'Be brief.', prompt: 'Tell me a joke.' })),
    kv('ai.response.text', 'Why did the chicken cross the road?'),
    kv('ai.usage.inputTokens', 100),
    kv('ai.usage.outputTokens', 20),
    kv('ai.usage.totalTokens', 120),
  ];
  const result = extractLlmSpanData(tags, [], 'ai.generateText my-function', { name: 'ai' });
  assertEquals(getSpanKind(tags), 'CHAIN', 'wrapper is a CHAIN');
  assertEquals(result.isLlm, false, 'the wrapper repeats the usage of its model calls, so it is not a model call');
  assertDeepEquals(result.inputMessages.map((m) => [m.role, m.content]), [['system', 'Be brief.'], ['user', 'Tell me a joke.']], 'ai.prompt system and prompt');
  assertEquals(result.outputMessages[0].content, 'Why did the chicken cross the road?', 'ai.response.text');
  assertEquals(result.model, 'model-a', 'model from ai.model.id');
  assertEquals(result.tokenUsage.total, 120, 'usage is still shown on the wrapper');
  assert(!isLlmSpan(tags), 'the wrapper is not an LLM span');
  assertEquals(getSpanDisplayName('ai.generateText my-function', tags), 'my-function:ai.generateText', 'function id prefixes the operation in the display name');
  assertEquals(getSpanDisplayName('ai.generateText', [kv('ai.operationId', 'ai.generateText')]), 'ai.generateText', 'no function id, no prefix');
  assertEquals(getSpanDisplayName('GET /health', []), 'GET /health', 'other spans keep their name');
});

describe('Vercel AI SDK wrapper with a message list prompt', () => {
  const tags = [
    kv('ai.operationId', 'ai.streamText'),
    kv('ai.prompt', JSON.stringify({ messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi there' }] }] })),
    kv('ai.response.text', 'Hello!'),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.inputMessages[0]?.content, 'Hi there', 'messages inside ai.prompt');
});

describe('Vercel AI SDK tool call span', () => {
  const tags = [
    kv('operation.name', 'ai.toolCall'),
    kv('ai.operationId', 'ai.toolCall'),
    kv('ai.toolCall.name', 'getWeather'),
    kv('ai.toolCall.id', 'call_a'),
    kv('ai.toolCall.args', '{"location":"Paris"}'),
    kv('ai.toolCall.result', '{"temp":21}'),
  ];
  const result = extractLlmSpanData(tags, [], 'ai.toolCall', { name: 'ai' });
  assertEquals(getSpanKind(tags), 'TOOL', 'tool kind');
  assertEquals(result.isLlm, false, 'not a model call');
  assertEquals(result.inputMessages[0].toolCalls?.[0].name, 'getWeather', 'tool name');
  assertEquals(result.inputMessages[0].toolCalls?.[0].id, 'call_a', 'tool call id');
  assertEquals(result.inputMessages[0].toolCalls?.[0].arguments, '{"location":"Paris"}', 'arguments from ai.toolCall.args');
  assert(result.outputMessages[0].parts?.[0].type === 'tool_result' && result.outputMessages[0].parts[0].result === '{"temp":21}', 'result from ai.toolCall.result');
  assertEquals(getSpanDisplayName('ai.toolCall', tags), 'getWeather', 'tool spans are named after the tool');
});

describe('Vercel AI SDK object generation', () => {
  const tags = [
    kv('ai.operationId', 'ai.generateObject.doGenerate'),
    kv('ai.model.id', 'model-a'),
    kv('ai.prompt.messages', JSON.stringify([{ role: 'user', content: [{ type: 'text', text: 'Make a person' }] }])),
    kv('ai.response.object', '{"name":"Ada","age":36}'),
    kv('ai.response.finishReason', 'stop'),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.outputMessages[0].content, '{"name":"Ada","age":36}', 'ai.response.object is the output');
  assertEquals(result.isLlm, true, 'object generation is a model call');
});

describe('Vercel AI SDK embedding call', () => {
  const tags = [
    kv('ai.operationId', 'ai.embedMany.doEmbed'),
    kv('ai.model.id', 'embed-a'),
    kv('ai.values', ['"first text"', '"second text"']),
    kv('ai.usage.tokens', 9),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(getSpanKind(tags), 'EMBEDDING', 'embedding kind');
  assertDeepEquals(result.inputMessages.map((m) => m.content), ['first text', 'second text'], 'embedded values are the input');
  assertEquals(result.tokenUsage.input, 9, 'ai.usage.tokens is the input token count');
  assert(isEmbeddingSpan(tags), 'isEmbeddingSpan');
  assertEquals(result.isLlm, true, 'embedding tokens count towards trace totals');
});

describe('Vercel AI SDK 7 uses GenAI attributes under the ai scope', () => {
  const tags = [
    kv('gen_ai.operation.name', 'chat'),
    kv('gen_ai.request.model', 'model-a'),
    kv('gen_ai.system_instructions', 'Answer concisely.'),
    kv('gen_ai.input.messages', JSON.stringify([{ role: 'user', content: 'hello' }])),
    kv('gen_ai.output.messages', JSON.stringify([{ role: 'assistant', content: 'hi' }])),
  ];
  const result = extractLlmSpanData(tags, [], 'chat model-a', { name: 'ai', version: '7.0.0' });
  assertEquals(result.framework, 'vercel-ai', 'scope ai');
  assertDeepEquals(result.inputMessages.map((m) => [m.role, m.content]), [['system', 'Answer concisely.'], ['user', 'hello']], 'system instructions and input');
  assertEquals(result.outputMessages[0].content, 'hi', 'output');
  const tool = extractLlmSpanData([
    kv('gen_ai.operation.name', 'execute_tool'),
    kv('gen_ai.tool.name', 'get_weather'),
    kv('gen_ai.tool.call.arguments', '{"location":"Berlin"}'),
    kv('gen_ai.tool.call.result', '{"temperature":21}'),
  ], [], 'execute_tool get_weather', { name: 'ai' });
  assertEquals(tool.inputMessages[0].toolCalls?.[0].arguments, '{"location":"Berlin"}', 'v7 tool arguments');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

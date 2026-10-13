// Unit tests for llmUtils.ts
// Run with: node --experimental-strip-types tests/llmUtils.unit.test.ts

import {
  extractLlmSpanData,
  getLlmDisplayAttributeKeys,
  isLlmSpan,
  isEmbeddingSpan,
  getSpanKind,
  getAgentName,
  getAgentDescription,
  type KeyValuePair,
  type SpanLog,
} from '../src/utils/llmUtils.ts';
import { ADK_EMPTY_LLM_RESPONSE, ADK_LLM_REQUEST, ADK_LLM_RESPONSE, ADK_SERIALIZATION_ERROR, ADK_TOOL_ARGS, ADK_TOOL_RESPONSE } from './fixtures/llm-trace.ts';

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

// ---------------------------------------------------------------------------
// Helper builders
// ---------------------------------------------------------------------------

function kv(key: string, value: unknown): KeyValuePair {
  return { key, value };
}

function log(name: string, fields: KeyValuePair[], timestamp = 0): SpanLog {
  return { timestamp, name, fields };
}

// ---------------------------------------------------------------------------
// 1. extractLlmSpanData — OpenInference attributes
// ---------------------------------------------------------------------------

describe('extractLlmSpanData — OpenInference convention', () => {
  const tags: KeyValuePair[] = [
    kv('openinference.span.kind', 'LLM'),
    kv('llm.model_name', 'gpt-4o'),
    kv('llm.system', 'openai'),
    kv('llm.invocation_parameters', '{"temperature":0.7,"max_tokens":512}'),
    kv('llm.input_messages.0.message.role', 'system'),
    kv('llm.input_messages.0.message.content', 'You are a helpful assistant.'),
    kv('llm.input_messages.1.message.role', 'user'),
    kv('llm.input_messages.1.message.content', 'Hello!'),
    kv('llm.output_messages.0.message.role', 'assistant'),
    kv('llm.output_messages.0.message.content', 'Hi there!'),
    kv('llm.output_messages.0.message.finish_reason', 'stop'),
    kv('llm.token_count.prompt', 20),
    kv('llm.token_count.completion', 10),
    kv('llm.token_count.total', 30),
  ];

  const result = extractLlmSpanData(tags, []);

  assertEquals(result.isLlm, true, 'isLlm is true for LLM kind');
  assertEquals(result.convention, 'openinference', 'convention = openinference');
  assertEquals(result.model, 'gpt-4o', 'model extracted');
  assertEquals(result.system, 'openai', 'system extracted from llm.system');
  assertEquals(result.spanKind, 'LLM', 'spanKind = LLM');
  assertEquals(result.inputMessages.length, 2, 'two input messages');
  assertEquals(result.inputMessages[0].role, 'system', 'first input role = system');
  assertEquals(result.inputMessages[0].content, 'You are a helpful assistant.', 'system content');
  assertEquals(result.inputMessages[1].role, 'user', 'second input role = user');
  assertEquals(result.outputMessages.length, 1, 'one output message');
  assertEquals(result.outputMessages[0].role, 'assistant', 'output role = assistant');
  assertEquals(result.outputMessages[0].content, 'Hi there!', 'output content');
  assertEquals(result.tokenUsage.input, 20, 'token input = 20');
  assertEquals(result.tokenUsage.output, 10, 'token output = 10');
  assertEquals(result.tokenUsage.total, 30, 'token total = 30');
  assertEquals(result.finishReason, 'stop', 'finishReason from output finish_reason');
  assertEquals((result.invocationParams as any).temperature, 0.7, 'temperature from invocation_parameters');
  assertEquals((result.invocationParams as any).max_tokens, 512, 'max_tokens from invocation_parameters');
});

describe('extractLlmSpanData — OpenInference CHAIN span is NOT isLlm', () => {
  const tags: KeyValuePair[] = [
    kv('openinference.span.kind', 'CHAIN'),
    kv('llm.model_name', 'gpt-4o'),
    kv('input.value', 'some question'),
    kv('output.value', 'some answer'),
  ];

  const result = extractLlmSpanData(tags, []);
  assertEquals(result.isLlm, false, 'CHAIN span isLlm = false');
  assertEquals(result.convention, 'openinference', 'convention still openinference');
  assertEquals(result.spanKind, 'CHAIN', 'spanKind = CHAIN');
});

describe('extractLlmSpanData — OpenInference with tool_calls in output', () => {
  const toolCallsJson = JSON.stringify([
    { id: 'call_abc', function: { name: 'search', arguments: '{"q":"hotels"}' } },
  ]);
  const tags: KeyValuePair[] = [
    kv('openinference.span.kind', 'LLM'),
    kv('llm.model_name', 'gpt-4o'),
    kv('llm.input_messages.0.message.role', 'user'),
    kv('llm.input_messages.0.message.content', 'Find hotels'),
    kv('llm.output_messages.0.message.role', 'assistant'),
    kv('llm.output_messages.0.message.content', ''),
    kv('llm.output_messages.0.message.tool_calls', toolCallsJson),
    kv('llm.token_count.prompt', 15),
    kv('llm.token_count.completion', 5),
    kv('llm.token_count.total', 20),
  ];

  const result = extractLlmSpanData(tags, []);
  assertEquals(result.isLlm, true, 'isLlm = true');
  assert(Array.isArray(result.outputMessages[0].toolCalls), 'tool calls parsed as array');
  assertEquals(result.outputMessages[0].toolCalls?.length, 1, 'one tool call');
  assertEquals(result.outputMessages[0].toolCalls?.[0].name, 'search', 'tool call name = search');
  assertEquals(result.outputMessages[0].toolCalls?.[0].id, 'call_abc', 'tool call id preserved');
});

// ---------------------------------------------------------------------------
// 2. extractLlmSpanData — OTel gen_ai attributes
// ---------------------------------------------------------------------------

describe('extractLlmSpanData — OTel gen_ai convention (from span events)', () => {
  const tags: KeyValuePair[] = [
    kv('gen_ai.system', 'openai'),
    kv('gen_ai.request.model', 'gpt-4o-mini'),
    kv('gen_ai.usage.input_tokens', 100),
    kv('gen_ai.usage.output_tokens', 50),
    kv('gen_ai.request.temperature', 0.5),
    kv('gen_ai.request.max_tokens', 256),
  ];

  const logs: SpanLog[] = [
    log('gen_ai.content.prompt', [
      kv('gen_ai.prompt', JSON.stringify([{ role: 'user', content: 'What is AI?' }])),
    ]),
    log('gen_ai.content.completion', [
      kv('gen_ai.completion', 'Artificial Intelligence is...'),
    ]),
  ];

  const result = extractLlmSpanData(tags, logs);

  assertEquals(result.isLlm, true, 'otel-genai isLlm = true');
  assertEquals(result.convention, 'otel-genai', 'convention = otel-genai');
  assertEquals(result.model, 'gpt-4o-mini', 'model from gen_ai.request.model');
  assertEquals(result.system, 'openai', 'system from gen_ai.system');
  assertEquals(result.tokenUsage.input, 100, 'input tokens');
  assertEquals(result.tokenUsage.output, 50, 'output tokens');
  assertEquals(result.inputMessages.length, 1, 'one input message from event');
  assertEquals(result.inputMessages[0].role, 'user', 'input message role');
  assertEquals(result.inputMessages[0].content, 'What is AI?', 'input message content');
  assertEquals(result.outputMessages.length, 1, 'one output message');
  assertEquals(result.outputMessages[0].content, 'Artificial Intelligence is...', 'output content');
  assertEquals(result.invocationParams.temperature, 0.5, 'temperature');
  assertEquals(result.invocationParams.maxTokens, 256, 'maxTokens');
});

describe('extractLlmSpanData — OTel gen_ai with plain text completion event', () => {
  const tags: KeyValuePair[] = [
    kv('gen_ai.system', 'anthropic'),
    kv('gen_ai.request.model', 'claude-3-haiku'),
  ];

  const logs: SpanLog[] = [
    log('gen_ai.content.prompt', [
      kv('gen_ai.prompt', 'Translate: Hello'),
    ]),
    log('gen_ai.content.completion', [
      kv('gen_ai.completion', 'Hola'),
    ]),
  ];

  const result = extractLlmSpanData(tags, logs);

  assertEquals(result.convention, 'otel-genai', 'convention = otel-genai');
  assertEquals(result.inputMessages[0].content, 'Translate: Hello', 'plain text prompt stored');
  assertEquals(result.inputMessages[0].role, 'user', 'default role = user');
  assertEquals(result.outputMessages[0].content, 'Hola', 'plain text completion stored');
  assertEquals(result.outputMessages[0].role, 'assistant', 'output role = assistant');
});

describe('extractLlmSpanData — OTel gen_ai system message event', () => {
  const tags: KeyValuePair[] = [
    kv('gen_ai.system', 'openai'),
    kv('gen_ai.request.model', 'gpt-4o'),
  ];

  const logs: SpanLog[] = [
    log('gen_ai.system.message', [
      kv('gen_ai.content', 'You are a concise assistant.'),
    ]),
    log('gen_ai.content.prompt', [
      kv('gen_ai.prompt', 'Summarize this.'),
    ]),
    log('gen_ai.content.completion', [
      kv('gen_ai.completion', 'A summary.'),
    ]),
  ];

  const result = extractLlmSpanData(tags, logs);

  assertEquals(result.inputMessages.length, 2, 'system + user = 2 messages');
  assertEquals(result.inputMessages[0].role, 'system', 'system message first');
  assertEquals(result.inputMessages[0].content, 'You are a concise assistant.', 'system content');
  assertEquals(result.inputMessages[1].role, 'user', 'user message second');
});

describe('extractLlmSpanData — OTel gen_ai finish reason', () => {
  const tags: KeyValuePair[] = [
    kv('gen_ai.system', 'openai'),
    kv('gen_ai.request.model', 'gpt-4'),
    kv('gen_ai.response.finish_reasons.0', 'length'),
  ];

  const result = extractLlmSpanData(tags, []);
  assertEquals(result.finishReason, 'length', 'finishReason from gen_ai.response.finish_reasons.0');
});

// ---------------------------------------------------------------------------
// 3. extractLlmSpanData — GCP Vertex / vertex convention
// ---------------------------------------------------------------------------

describe('extractLlmSpanData — Vertex AI via gen_ai.system=vertex_ai', () => {
  const tags: KeyValuePair[] = [
    kv('gen_ai.system', 'vertex_ai'),
    kv('gen_ai.request.model', 'gemini-1.5-pro'),
    kv('llm.prompts.0.role', 'user'),
    kv('llm.prompts.0.content', 'Describe the Eiffel Tower.'),
    kv('llm.completions.0.role', 'model'),
    kv('llm.completions.0.content', 'The Eiffel Tower is a landmark in Paris.'),
    kv('llm.token_count.prompt', 12),
    kv('llm.token_count.completion', 20),
    kv('llm.token_count.total', 32),
  ];

  const result = extractLlmSpanData(tags, []);

  // detectConvention returns 'vertex' and extractLlmSpanData preserves it.
  assertEquals(result.convention, 'vertex', 'convention = vertex for vertex_ai system');
  assertEquals(result.isLlm, true, 'vertex isLlm = true');
  assertEquals(result.model, 'gemini-1.5-pro', 'model from gen_ai.request.model');
  assertEquals(result.system, 'vertex_ai', 'system = vertex_ai');
  assertEquals(result.tokenUsage.input, 12, 'prompt tokens');
  assertEquals(result.tokenUsage.output, 20, 'completion tokens');
  assertEquals(result.tokenUsage.total, 32, 'total tokens');
});

describe('extractLlmSpanData — Vertex AI via llm.prompts prefix (no gen_ai.system)', () => {
  const tags: KeyValuePair[] = [
    kv('llm.prompts.0.role', 'user'),
    kv('llm.prompts.0.content', 'Hello from vertex'),
    kv('llm.completions.0.role', 'model'),
    kv('llm.completions.0.content', 'Hello back'),
  ];

  const result = extractLlmSpanData(tags, []);
  // detectConvention returns 'vertex' and extractLlmSpanData preserves it.
  assertEquals(result.convention, 'vertex', 'convention = vertex for llm.prompts prefix');
  assertEquals(result.isLlm, true, 'vertex isLlm = true');
});

// ---------------------------------------------------------------------------
// 4. extractLlmSpanData — generic/unknown attributes
// ---------------------------------------------------------------------------

describe('extractLlmSpanData — generic convention (operation.type=completion)', () => {
  const messagesJson = JSON.stringify([
    { role: 'user', content: 'Generic question' },
  ]);
  const tags: KeyValuePair[] = [
    kv('operation.type', 'chat_completion'),
    kv('model', 'my-custom-model'),
    kv('input.value', messagesJson),
    kv('temperature', 0.9),
    kv('max_tokens', 100),
    kv('prompt_tokens', 25),
    kv('completion_tokens', 15),
    kv('total_tokens', 40),
  ];

  const result = extractLlmSpanData(tags, []);
  assertEquals(result.convention, 'generic', 'convention = generic');
  assertEquals(result.isLlm, true, 'generic isLlm = true');
  assertEquals(result.model, 'my-custom-model', 'model from model attr');
  assertEquals(result.tokenUsage.input, 25, 'prompt_tokens');
  assertEquals(result.tokenUsage.output, 15, 'completion_tokens');
  assertEquals(result.tokenUsage.total, 40, 'total_tokens');
  assertEquals(result.invocationParams.temperature, 0.9, 'temperature from generic tag');
  assertEquals(result.invocationParams.maxTokens, 100, 'maxTokens from generic tag');
  assertEquals(result.inputMessages.length, 1, 'input message from JSON input.value');
  assertEquals(result.inputMessages[0].role, 'user', 'user role in generic input');
});

describe('extractLlmSpanData — unknown (no LLM markers)', () => {
  const tags: KeyValuePair[] = [
    kv('http.method', 'GET'),
    kv('http.url', '/api/users'),
    kv('http.status_code', 200),
  ];

  const result = extractLlmSpanData(tags, []);
  assertEquals(result.isLlm, false, 'non-LLM span isLlm = false');
  assertEquals(result.convention, 'unknown', 'convention = unknown');
  assertEquals(result.model, '', 'model empty for unknown');
  assertEquals(result.inputMessages.length, 0, 'no input messages');
  assertEquals(result.outputMessages.length, 0, 'no output messages');
});

describe('extractLlmSpanData — generic with operationName fallback', () => {
  const msgJson = JSON.stringify([{ role: 'user', content: 'test' }]);
  const tags: KeyValuePair[] = [
    kv('operation.type', 'chat_completion'),
    kv('input.value', msgJson),
  ];

  const result = extractLlmSpanData(tags, [], 'my-llm-op');
  assertEquals(result.model, 'my-llm-op', 'model falls back to operationName');
});

// ---------------------------------------------------------------------------
// 5. isLlmSpan — various attribute combinations
// ---------------------------------------------------------------------------

describe('isLlmSpan — openinference.span.kind=LLM', () => {
  assert(isLlmSpan([kv('openinference.span.kind', 'LLM')]), 'kind=LLM is LLM span');
  assert(!isLlmSpan([kv('openinference.span.kind', 'CHAIN')]), 'kind=CHAIN is NOT LLM span');
  assert(!isLlmSpan([kv('openinference.span.kind', 'TOOL')]), 'kind=TOOL is NOT LLM span');
  assert(!isLlmSpan([kv('openinference.span.kind', 'RETRIEVER')]), 'kind=RETRIEVER is NOT LLM span');
  assert(!isLlmSpan([kv('openinference.span.kind', 'EMBEDDING')]), 'kind=EMBEDDING is NOT LLM span');
  assert(!isLlmSpan([kv('openinference.span.kind', 'AGENT')]), 'kind=AGENT is NOT LLM span');
});

describe('isLlmSpan — gen_ai attributes (OTel)', () => {
  assert(isLlmSpan([kv('gen_ai.system', 'openai')]), 'gen_ai.system = LLM span');
  assert(isLlmSpan([kv('gen_ai.request.model', 'gpt-4')]), 'gen_ai.request.model = LLM span');
  assert(isLlmSpan([kv('gen_ai.usage.input_tokens', 100)]), 'gen_ai.usage.* = LLM span');
});

describe('isLlmSpan — OpenInference model/message attrs (no span.kind)', () => {
  assert(isLlmSpan([kv('llm.model_name', 'gpt-4')]), 'llm.model_name = LLM span');
  assert(isLlmSpan([kv('llm.request.type', 'chat')]), 'llm.request.type = LLM span');
  assert(isLlmSpan([kv('llm.input_messages.0.message.role', 'user')]), 'llm.input_messages.* = LLM span');
  assert(isLlmSpan([kv('llm.prompts.0.role', 'user')]), 'llm.prompts.* = LLM span');
});

describe('isLlmSpan — non-LLM spans', () => {
  assert(!isLlmSpan([]), 'empty tags = not LLM');
  assert(!isLlmSpan([kv('http.method', 'POST'), kv('http.url', '/api')]), 'HTTP span = not LLM');
  assert(!isLlmSpan([kv('db.system', 'postgresql'), kv('db.statement', 'SELECT 1')]), 'DB span = not LLM');
});

describe('isLlmSpan — GCP vertex agent attrs (no gen_ai.system)', () => {
  assert(isLlmSpan([kv('gcp.vertex.agent.llm_request', '{}')]), 'gcp.vertex.agent.llm_request = LLM span');
  assert(isLlmSpan([kv('gcp.vertex.agent.llm_response', '{}')]), 'gcp.vertex.agent.llm_response = LLM span');
});

describe('isLlmSpan — generic operation.type completion', () => {
  assert(isLlmSpan([kv('operation.type', 'chat_completion')]), 'operation.type=chat_completion = LLM span');
  assert(isLlmSpan([kv('llm.operation.type', 'completion')]), 'llm.operation.type=completion = LLM span');
  assert(!isLlmSpan([kv('operation.type', 'http_request')]), 'operation.type=http_request is NOT LLM span');
});

// ---------------------------------------------------------------------------
// 6. detectConvention — tested indirectly via extractLlmSpanData.convention
// ---------------------------------------------------------------------------

describe('detectConvention — openinference.span.kind takes priority', () => {
  // Even if gen_ai attrs exist, openinference.span.kind wins
  const tags: KeyValuePair[] = [
    kv('openinference.span.kind', 'LLM'),
    kv('gen_ai.system', 'openai'),
    kv('llm.model_name', 'gpt-4'),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.convention, 'openinference', 'openinference wins over gen_ai');
});

describe('detectConvention — vertex detected before otel-genai when system=vertex_ai', () => {
  // detectConvention returns 'vertex' for vertex_ai and extractLlmSpanData preserves it.
  const tags: KeyValuePair[] = [
    kv('gen_ai.system', 'vertex_ai'),
    kv('gen_ai.request.model', 'gemini-pro'),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.convention, 'vertex', 'vertex_ai system -> convention = vertex');
  assertEquals(result.isLlm, true, 'vertex span isLlm = true');
  assertEquals(result.model, 'gemini-pro', 'model extracted via vertex extractor');
});

describe('detectConvention — vertex detected when gen_ai.system contains gcp', () => {
  const tags: KeyValuePair[] = [
    kv('gen_ai.system', 'gcp-vertex'),
    kv('gen_ai.request.model', 'gemini-1.0'),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.convention, 'vertex', 'gcp system -> convention = vertex');
  assertEquals(result.isLlm, true, 'gcp system isLlm = true');
  assertEquals(result.model, 'gemini-1.0', 'model extracted');
});

describe('detectConvention — vertex detected from gcp.vertex.agent.llm_request alone (no gen_ai.system)', () => {
  const llmRequest = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
  });
  const tags: KeyValuePair[] = [
    kv('gcp.vertex.agent.llm_request', llmRequest),
    kv('gen_ai.request.model', 'gemini-2.0-flash'),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.convention, 'vertex', 'gcp.vertex.agent.* alone -> convention = vertex');
  assertEquals(result.isLlm, true, 'isLlm = true');
  assertEquals(result.inputMessages.length, 1, 'message parsed from llm_request blob');
  assertEquals(result.inputMessages[0].content, 'Hello', 'content from gcp blob');
});

describe('detectConvention — otel-genai detected from gen_ai.system alone', () => {
  const tags: KeyValuePair[] = [
    kv('gen_ai.system', 'anthropic'),
    kv('gen_ai.request.model', 'claude-3-opus'),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.convention, 'otel-genai', 'anthropic system -> otel-genai');
});

describe('detectConvention — openinference detected from llm.model_name alone', () => {
  const tags: KeyValuePair[] = [
    kv('llm.model_name', 'gpt-3.5-turbo'),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.convention, 'openinference', 'llm.model_name -> openinference');
});

describe('detectConvention — generic from message-like value', () => {
  const msgJson = JSON.stringify([{ role: 'user', content: 'hello world' }]);
  const tags: KeyValuePair[] = [
    kv('request.body', msgJson),
    kv('operation.type', 'chat_completion'),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.convention, 'generic', 'message-like value -> generic');
});

// ---------------------------------------------------------------------------
// 7. extractIndexedMessages — tested via extractLlmSpanData
// ---------------------------------------------------------------------------

describe('extractIndexedMessages — ordering by index', () => {
  const tags: KeyValuePair[] = [
    kv('openinference.span.kind', 'LLM'),
    // Intentionally out of order
    kv('llm.input_messages.2.message.role', 'assistant'),
    kv('llm.input_messages.2.message.content', 'second response'),
    kv('llm.input_messages.0.message.role', 'system'),
    kv('llm.input_messages.0.message.content', 'sys prompt'),
    kv('llm.input_messages.1.message.role', 'user'),
    kv('llm.input_messages.1.message.content', 'first question'),
  ];

  const result = extractLlmSpanData(tags, []);
  assertEquals(result.inputMessages.length, 3, 'three messages extracted in order');
  assertEquals(result.inputMessages[0].role, 'system', 'index 0 = system');
  assertEquals(result.inputMessages[1].role, 'user', 'index 1 = user');
  assertEquals(result.inputMessages[2].role, 'assistant', 'index 2 = assistant');
});

describe('extractIndexedMessages — tool role message', () => {
  const tags: KeyValuePair[] = [
    kv('openinference.span.kind', 'LLM'),
    kv('llm.input_messages.0.message.role', 'user'),
    kv('llm.input_messages.0.message.content', 'What is the weather?'),
    kv('llm.input_messages.1.message.role', 'tool'),
    kv('llm.input_messages.1.message.name', 'get_weather'),
    kv('llm.input_messages.1.message.tool_call_id', 'call_weather_1'),
    kv('llm.input_messages.1.message.content', '{"temperature": "22C", "condition": "sunny"}'),
  ];

  const result = extractLlmSpanData(tags, []);
  assertEquals(result.inputMessages[1].role, 'tool', 'tool role preserved');
  assert(result.inputMessages[1].content.includes('22C'), 'tool result content preserved');
  assertEquals(result.inputMessages[1].parts?.[0].type, 'tool_result', 'tool content is normalized as a result part');
  assertEquals(result.inputMessages[1].toolCallId, 'call_weather_1', 'responding tool call ID preserved');
  assertEquals(result.inputMessages[1].name, 'get_weather', 'tool name preserved');
});

describe('extractIndexedMessages — short-form role/content keys', () => {
  // Some frameworks use llm.input_messages.0.role (no "message." prefix)
  const tags: KeyValuePair[] = [
    kv('openinference.span.kind', 'LLM'),
    kv('llm.input_messages.0.role', 'user'),
    kv('llm.input_messages.0.content', 'Short form test'),
    kv('llm.output_messages.0.role', 'assistant'),
    kv('llm.output_messages.0.content', 'Short form reply'),
  ];

  const result = extractLlmSpanData(tags, []);
  assertEquals(result.inputMessages[0].role, 'user', 'short-form role extracted');
  assertEquals(result.inputMessages[0].content, 'Short form test', 'short-form content extracted');
  assertEquals(result.outputMessages[0].role, 'assistant', 'short-form output role');
  assertEquals(result.outputMessages[0].content, 'Short form reply', 'short-form output content');
});

// ---------------------------------------------------------------------------
// 8. Edge cases
// ---------------------------------------------------------------------------

describe('Edge case — empty tags and logs', () => {
  const result = extractLlmSpanData([], []);
  assertEquals(result.isLlm, false, 'empty tags -> not LLM');
  assertEquals(result.convention, 'unknown', 'empty tags -> unknown');
  assertEquals(result.inputMessages.length, 0, 'no input messages');
  assertEquals(result.outputMessages.length, 0, 'no output messages');
  assertDeepEquals(result.tokenUsage, {}, 'empty tokenUsage');
  assertDeepEquals(result.invocationParams, {}, 'empty invocationParams');
});

describe('Edge case — NaN token values are ignored', () => {
  const tags: KeyValuePair[] = [
    kv('openinference.span.kind', 'LLM'),
    kv('llm.model_name', 'gpt-4'),
    kv('llm.token_count.prompt', 'not-a-number'),
    kv('llm.token_count.completion', null),
    kv('llm.token_count.total', undefined),
  ];

  const result = extractLlmSpanData(tags, []);
  assertEquals(result.tokenUsage.input, undefined, 'invalid prompt tokens -> undefined');
  // BUG-047 fix: null values now return undefined instead of 0
  assertEquals(result.tokenUsage.output, undefined, 'null value now returns undefined (BUG-047 fix)');
  assertEquals(result.tokenUsage.total, undefined, 'undefined total tokens -> undefined');
});

describe('Edge case — invocation_parameters invalid JSON is ignored', () => {
  const tags: KeyValuePair[] = [
    kv('openinference.span.kind', 'LLM'),
    kv('llm.model_name', 'gpt-4'),
    kv('llm.invocation_parameters', '{invalid json}'),
  ];

  const result = extractLlmSpanData(tags, []);
  assertDeepEquals(result.invocationParams, {}, 'invalid JSON -> empty invocationParams');
});

describe('Edge case — mixed convention attrs (openinference + gen_ai)', () => {
  // openinference.span.kind present — should use openinference path
  const tags: KeyValuePair[] = [
    kv('openinference.span.kind', 'LLM'),
    kv('llm.model_name', 'claude-3-sonnet'),
    kv('gen_ai.usage.input_tokens', 200),   // gen_ai tokens also present
    kv('gen_ai.usage.output_tokens', 80),
    kv('llm.input_messages.0.message.role', 'user'),
    kv('llm.input_messages.0.message.content', 'Mixed query'),
    kv('llm.output_messages.0.message.role', 'assistant'),
    kv('llm.output_messages.0.message.content', 'Mixed response'),
  ];

  const result = extractLlmSpanData(tags, []);
  assertEquals(result.convention, 'openinference', 'openinference wins mixed');
  // OpenInference extractor falls back to gen_ai.usage tokens when llm.token_count absent
  assertEquals(result.tokenUsage.input, 200, 'falls back to gen_ai.usage.input_tokens');
  assertEquals(result.tokenUsage.output, 80, 'falls back to gen_ai.usage.output_tokens');
});

describe('Edge case — OTel genai with no logs but gen_ai.prompt tag', () => {
  const tags: KeyValuePair[] = [
    kv('gen_ai.system', 'openai'),
    kv('gen_ai.request.model', 'gpt-4o'),
    kv('gen_ai.prompt', 'Hello from tag'),
    kv('gen_ai.completion', 'Reply from tag'),
  ];

  const result = extractLlmSpanData(tags, []);
  assertEquals(result.convention, 'otel-genai', 'convention = otel-genai');
  assertEquals(result.inputMessages[0].content, 'Hello from tag', 'prompt from tag attr');
  assertEquals(result.outputMessages[0].content, 'Reply from tag', 'completion from tag attr');
});

describe('Edge case — OpenInference falls back to input.value / output.value', () => {
  const tags: KeyValuePair[] = [
    kv('openinference.span.kind', 'LLM'),
    kv('llm.model_name', 'gpt-4'),
    kv('input.value', 'Plain text input'),
    kv('output.value', 'Plain text output'),
  ];

  const result = extractLlmSpanData(tags, []);
  assertEquals(result.inputMessages.length, 1, 'one input from input.value');
  assertEquals(result.inputMessages[0].content, 'Plain text input', 'input.value used as content');
  assertEquals(result.inputMessages[0].role, 'user', 'default role = user for plain input');
  assertEquals(result.outputMessages.length, 1, 'one output from output.value');
  assertEquals(result.outputMessages[0].role, 'assistant', 'default role = assistant for plain output');
});

describe('Edge case — OpenInference falls back to logs when no messages in tags', () => {
  const tags: KeyValuePair[] = [
    kv('openinference.span.kind', 'LLM'),
    kv('llm.model_name', 'gpt-4'),
  ];
  const logs: SpanLog[] = [
    log('gen_ai.content.prompt', [
      kv('gen_ai.prompt', 'From log event'),
    ]),
    log('gen_ai.content.completion', [
      kv('gen_ai.completion', 'Log reply'),
    ]),
  ];

  const result = extractLlmSpanData(tags, logs);
  assertEquals(result.inputMessages[0].content, 'From log event', 'input from log event');
  assertEquals(result.outputMessages[0].content, 'Log reply', 'output from log event');
});

describe('Edge case — isLlmSpan case-sensitivity for span.kind', () => {
  assert(isLlmSpan([kv('openinference.span.kind', 'llm')]), 'lowercase llm is detected as LLM');
  assert(isLlmSpan([kv('openinference.span.kind', 'Llm')]), 'mixed case Llm is detected as LLM');
  assert(!isLlmSpan([kv('openinference.span.kind', 'chain')]), 'lowercase chain is not LLM');
});

// ---------------------------------------------------------------------------
// 9. Vertex AI — llm.prompts/completions message extraction
// ---------------------------------------------------------------------------

describe('Vertex AI — llm.prompts/completions message content extraction', () => {
  const tags: KeyValuePair[] = [
    kv('gen_ai.system', 'vertex_ai'),
    kv('gen_ai.request.model', 'gemini-1.5-pro'),
    kv('llm.prompts.0.role', 'user'),
    kv('llm.prompts.0.content', 'Describe the Eiffel Tower.'),
    kv('llm.completions.0.role', 'model'),
    kv('llm.completions.0.content', 'The Eiffel Tower is an iconic iron lattice tower.'),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.inputMessages.length, 1, 'one input message from llm.prompts');
  assertEquals(result.inputMessages[0].role, 'user', 'llm.prompts role extracted');
  assertEquals(result.inputMessages[0].content, 'Describe the Eiffel Tower.', 'llm.prompts content extracted');
  assertEquals(result.outputMessages.length, 1, 'one output message from llm.completions');
  assertEquals(result.outputMessages[0].role, 'model', 'llm.completions role extracted');
  assertEquals(result.outputMessages[0].content, 'The Eiffel Tower is an iconic iron lattice tower.', 'llm.completions content extracted');
});

describe('Vertex AI — multi-turn llm.prompts ordering preserved', () => {
  const tags: KeyValuePair[] = [
    kv('gen_ai.system', 'vertex_ai'),
    kv('llm.prompts.0.role', 'system'),
    kv('llm.prompts.0.content', 'You are a helpful assistant.'),
    kv('llm.prompts.1.role', 'user'),
    kv('llm.prompts.1.content', 'Hello!'),
    kv('llm.completions.0.role', 'model'),
    kv('llm.completions.0.content', 'Hi there!'),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.inputMessages.length, 2, 'two input messages preserved in order');
  assertEquals(result.inputMessages[0].role, 'system', 'index 0 = system');
  assertEquals(result.inputMessages[1].role, 'user', 'index 1 = user');
  assertEquals(result.outputMessages[0].content, 'Hi there!', 'completion content correct');
});

describe('Vertex AI — llm.input_messages takes priority over llm.prompts', () => {
  // Standard OpenInference messages should not be overwritten by llm.prompts fallback
  const tags: KeyValuePair[] = [
    kv('openinference.span.kind', 'LLM'),
    kv('llm.model_name', 'gemini-pro'),
    kv('llm.input_messages.0.message.role', 'user'),
    kv('llm.input_messages.0.message.content', 'Primary message'),
    kv('llm.prompts.0.role', 'user'),
    kv('llm.prompts.0.content', 'Should not appear'),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.inputMessages.length, 1, 'only one input message');
  assertEquals(result.inputMessages[0].content, 'Primary message', 'llm.input_messages wins over llm.prompts');
});

// ---------------------------------------------------------------------------
// 10. Traceloop — gen_ai.prompt.{i}/gen_ai.completion.{i} flat indexed format
// ---------------------------------------------------------------------------

describe('Traceloop — gen_ai.prompt/completion flat indexed message extraction', () => {
  const tags: KeyValuePair[] = [
    kv('gen_ai.system', 'openai'),
    kv('gen_ai.request.model', 'gpt-4o'),
    kv('gen_ai.prompt.0.role', 'system'),
    kv('gen_ai.prompt.0.content', 'You are a code reviewer.'),
    kv('gen_ai.prompt.1.role', 'user'),
    kv('gen_ai.prompt.1.content', 'Review this function.'),
    kv('gen_ai.completion.0.role', 'assistant'),
    kv('gen_ai.completion.0.content', 'Looks good, add null checks.'),
    kv('gen_ai.usage.input_tokens', 45),
    kv('gen_ai.usage.output_tokens', 12),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.inputMessages.length, 2, 'two input messages from gen_ai.prompt.*');
  assertEquals(result.inputMessages[0].role, 'system', 'gen_ai.prompt.0 role = system');
  assertEquals(result.inputMessages[0].content, 'You are a code reviewer.', 'gen_ai.prompt.0 content');
  assertEquals(result.inputMessages[1].role, 'user', 'gen_ai.prompt.1 role = user');
  assertEquals(result.outputMessages.length, 1, 'one output from gen_ai.completion.*');
  assertEquals(result.outputMessages[0].role, 'assistant', 'gen_ai.completion.0 role = assistant');
  assertEquals(result.outputMessages[0].content, 'Looks good, add null checks.', 'gen_ai.completion.0 content');
  assertEquals(result.tokenUsage.input, 45, 'input tokens from gen_ai.usage');
  assertEquals(result.tokenUsage.output, 12, 'output tokens from gen_ai.usage');
});

describe('Traceloop — span events take priority over gen_ai.prompt.* indexed attrs', () => {
  const tags: KeyValuePair[] = [
    kv('gen_ai.system', 'openai'),
    kv('gen_ai.request.model', 'gpt-4o'),
    kv('gen_ai.prompt.0.role', 'user'),
    kv('gen_ai.prompt.0.content', 'Flat indexed (should be ignored)'),
  ];
  const logs: SpanLog[] = [
    log('gen_ai.content.prompt', [
      kv('gen_ai.prompt', 'Event content wins'),
    ]),
  ];
  const result = extractLlmSpanData(tags, logs);
  assertEquals(result.inputMessages[0].content, 'Event content wins', 'span event content wins over flat indexed');
});

describe('Traceloop — gen_ai.prompt tag attr takes priority over gen_ai.prompt.* indexed', () => {
  const tags: KeyValuePair[] = [
    kv('gen_ai.system', 'openai'),
    kv('gen_ai.prompt', 'Direct prompt attr wins'),
    kv('gen_ai.prompt.0.role', 'user'),
    kv('gen_ai.prompt.0.content', 'Flat indexed (should be ignored)'),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.inputMessages[0].content, 'Direct prompt attr wins', 'gen_ai.prompt attr wins over indexed');
});

// ---------------------------------------------------------------------------
// 11. GCP Vertex JSON blobs (gcp.vertex.agent.llm_request / llm_response)
// ---------------------------------------------------------------------------

describe('GCP Vertex — llm_request blob with contents array', () => {
  const llmRequest = JSON.stringify({
    contents: [
      { role: 'user', parts: [{ text: 'What is the weather in Paris?' }] },
    ],
  });
  const llmResponse = JSON.stringify({
    candidates: [
      { content: { role: 'model', parts: [{ text: 'The weather in Paris is sunny.' }] } },
    ],
  });
  const tags = [
    kv('gen_ai.system', 'vertex_ai'),
    kv('gen_ai.request.model', 'gemini-2.0-flash'),
    kv('gcp.vertex.agent.llm_request', llmRequest),
    kv('gcp.vertex.agent.llm_response', llmResponse),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.inputMessages.length, 1, 'one input message from llm_request');
  assertEquals(result.inputMessages[0].role, 'user', 'user role from contents');
  assertEquals(result.inputMessages[0].content, 'What is the weather in Paris?', 'content from parts.text');
  assertEquals(result.outputMessages.length, 1, 'one output message from llm_response');
  assertEquals(result.outputMessages[0].role, 'model', 'model role from candidates');
  assertEquals(result.outputMessages[0].content, 'The weather in Paris is sunny.', 'content from candidates parts');
});

describe('GCP Vertex — llm_request with system_instruction', () => {
  const llmRequest = JSON.stringify({
    system_instruction: { parts: [{ text: 'You are a weather expert.' }] },
    contents: [
      { role: 'user', parts: [{ text: 'What is the weather?' }] },
    ],
  });
  const tags = [
    kv('gen_ai.system', 'vertex_ai'),
    kv('gcp.vertex.agent.llm_request', llmRequest),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.inputMessages.length, 2, 'system + user = 2 messages');
  assertEquals(result.inputMessages[0].role, 'system', 'system_instruction becomes system role');
  assertEquals(result.inputMessages[0].content, 'You are a weather expert.', 'system_instruction content');
  assertEquals(result.inputMessages[1].role, 'user', 'user content follows');
});

describe('GCP Vertex — llm_request multi-turn conversation', () => {
  const llmRequest = JSON.stringify({
    contents: [
      { role: 'user', parts: [{ text: 'Hello' }] },
      { role: 'model', parts: [{ text: 'Hi there!' }] },
      { role: 'user', parts: [{ text: 'How are you?' }] },
    ],
  });
  const tags = [
    kv('gen_ai.system', 'vertex_ai'),
    kv('gcp.vertex.agent.llm_request', llmRequest),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.inputMessages.length, 3, 'three messages in multi-turn');
  assertEquals(result.inputMessages[0].role, 'user', 'turn 0 = user');
  assertEquals(result.inputMessages[1].role, 'model', 'turn 1 = model');
  assertEquals(result.inputMessages[2].role, 'user', 'turn 2 = user');
});

describe('GCP Vertex — llm_request blob does not override llm.prompts', () => {
  const llmRequest = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: 'GCP blob (should be ignored)' }] }],
  });
  const tags = [
    kv('gen_ai.system', 'vertex_ai'),
    kv('llm.prompts.0.role', 'user'),
    kv('llm.prompts.0.content', 'Primary message from llm.prompts'),
    kv('gcp.vertex.agent.llm_request', llmRequest),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.inputMessages[0].content, 'Primary message from llm.prompts', 'llm.prompts wins over gcp blob');
});

// ---------------------------------------------------------------------------
// 12. gen_ai.input_messages / gen_ai.output_messages JSON arrays
// ---------------------------------------------------------------------------

describe('gen_ai.input_messages / gen_ai.output_messages JSON string arrays', () => {
  const inputMsgs = JSON.stringify([
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Explain quantum computing.' },
  ]);
  const outputMsgs = JSON.stringify([
    { role: 'assistant', content: 'Quantum computing uses quantum bits...' },
  ]);
  const tags = [
    kv('gen_ai.system', 'openai'),
    kv('gen_ai.request.model', 'gpt-4o'),
    kv('gen_ai.input_messages', inputMsgs),
    kv('gen_ai.output_messages', outputMsgs),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.inputMessages.length, 2, 'two messages from gen_ai.input_messages');
  assertEquals(result.inputMessages[0].role, 'system', 'system message extracted');
  assertEquals(result.inputMessages[0].content, 'You are a helpful assistant.', 'system content');
  assertEquals(result.inputMessages[1].role, 'user', 'user message extracted');
  assertEquals(result.outputMessages.length, 1, 'one output from gen_ai.output_messages');
  assertEquals(result.outputMessages[0].content, 'Quantum computing uses quantum bits...', 'output content');
});

describe('gen_ai.input_messages lower priority than span events', () => {
  const inputMsgs = JSON.stringify([{ role: 'user', content: 'JSON attr (should be ignored)' }]);
  const tags = [
    kv('gen_ai.system', 'openai'),
    kv('gen_ai.input_messages', inputMsgs),
  ];
  const logs: SpanLog[] = [
    log('gen_ai.content.prompt', [kv('gen_ai.prompt', 'Event wins over JSON attr')]),
  ];
  const result = extractLlmSpanData(tags, logs);
  assertEquals(result.inputMessages[0].content, 'Event wins over JSON attr', 'span event wins over gen_ai.input_messages');
});

// ---------------------------------------------------------------------------
// 13. extractMessagesFromJsonValue — wrapped object formats (untested paths)
// ---------------------------------------------------------------------------

describe('extractMessagesFromJsonValue — {messages:[...]} wrapper object', () => {
  // The function handles top-level objects whose messages/Messages/prompt field
  // is an array.  None of the existing tests exercised this code path.
  const wrapped = JSON.stringify({
    messages: [
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'Summarise the report.' },
    ],
  });
  const tags: KeyValuePair[] = [
    kv('operation.type', 'chat_completion'),
    kv('input.value', wrapped),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.convention, 'generic', 'convention = generic for wrapped messages');
  assertEquals(result.inputMessages.length, 2, 'two messages extracted from {messages:[...]}');
  assertEquals(result.inputMessages[0].role, 'system', 'system role extracted');
  assertEquals(result.inputMessages[0].content, 'Be concise.', 'system content extracted');
  assertEquals(result.inputMessages[1].role, 'user', 'user role extracted');
  assertEquals(result.inputMessages[1].content, 'Summarise the report.', 'user content extracted');
});

describe('extractMessagesFromJsonValue — single-message {role,content} object', () => {
  // A top-level object (not an array) with role + content should yield one message.
  const singleMsg = JSON.stringify({ role: 'user', content: 'Single object message.' });
  const tags: KeyValuePair[] = [
    kv('operation.type', 'chat_completion'),
    kv('input.value', singleMsg),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.inputMessages.length, 1, 'one message from single {role,content} object');
  assertEquals(result.inputMessages[0].role, 'user', 'role preserved');
  assertEquals(result.inputMessages[0].content, 'Single object message.', 'content preserved');
});

// ---------------------------------------------------------------------------
// 14. looksLikeMessages — boundary / negative cases
// ---------------------------------------------------------------------------

describe('looksLikeMessages boundary — string shorter than 10 chars is rejected', () => {
  // Even if it contains "role", strings under 10 chars are not treated as messages.
  // The generic extractor therefore won't pick them up, preventing false positives.
  const tinyJson = '{"role":"'; // 9 chars, malformed but short
  const tags: KeyValuePair[] = [
    kv('operation.type', 'chat_completion'),
    kv('input.value', tinyJson),
  ];
  const result = extractLlmSpanData(tags, []);
  // Should not extract any messages because looksLikeMessages returns false
  assertEquals(result.inputMessages.length, 0, 'too-short string produces no messages');
});

describe('looksLikeMessages boundary — has "role" but no "content" or "message" is rejected', () => {
  // JSON with "role" key but neither "content" nor "message" sub-key should NOT
  // pass looksLikeMessages, so no messages are extracted.
  const noContent = JSON.stringify([{ role: 'user', text: 'hello' }]); // "text" instead of "content"
  const tags: KeyValuePair[] = [
    kv('operation.type', 'chat_completion'),
    kv('input.value', noContent),
  ];
  const result = extractLlmSpanData(tags, []);
  // looksLikeMessages requires "content" or "message" — pure "text" field fails the check
  assertEquals(result.inputMessages.length, 0, 'missing "content"/"message" key → no messages extracted');
});

// ---------------------------------------------------------------------------
// 15. Generic convention — plain-text output.value is NOT extracted as message
// ---------------------------------------------------------------------------

describe('Generic convention — plain-text output.value without message structure', () => {
  // The generic extractor only converts output.value to messages when looksLikeMessages
  // returns true.  Plain strings should NOT appear as an output message.
  const inputJson = JSON.stringify([{ role: 'user', content: 'What is 2+2?' }]);
  const tags: KeyValuePair[] = [
    kv('operation.type', 'chat_completion'),
    kv('input.value', inputJson),
    kv('output.value', 'The answer is 4.'),   // plain text, no role/content keys
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.inputMessages.length, 1, 'input message extracted normally');
  assertEquals(result.outputMessages.length, 0, 'plain-text output.value produces no output messages');
});

// ---------------------------------------------------------------------------
// 16. OpenInference — null / empty content strings do not crash extraction
// ---------------------------------------------------------------------------

describe('OpenInference — null-like content values in indexed messages', () => {
  // Some instrumentation libraries emit null or empty string for content.
  // Extraction should still succeed without throwing.
  const tags: KeyValuePair[] = [
    kv('openinference.span.kind', 'LLM'),
    kv('llm.model_name', 'gpt-4'),
    kv('llm.input_messages.0.message.role', 'user'),
    kv('llm.input_messages.0.message.content', null),   // null content
    kv('llm.input_messages.1.message.role', 'assistant'),
    kv('llm.input_messages.1.message.content', ''),     // empty string content
    kv('llm.output_messages.0.message.role', 'assistant'),
    kv('llm.output_messages.0.message.content', null),  // null output
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.isLlm, true, 'isLlm = true even with null/empty content');
  assertEquals(result.inputMessages.length, 2, 'two input messages despite null/empty content');
  assertEquals(result.inputMessages[0].role, 'user', 'role preserved for null-content message');
  assertEquals(result.inputMessages[0].content, 'null', 'null coerced to string "null"');
  assertEquals(result.inputMessages[1].content, '', 'empty string content preserved');
  assertEquals(result.outputMessages.length, 1, 'output message present despite null content');
});

// ---------------------------------------------------------------------------
// 17. Generic convention — output JSON array with messages extracted correctly
// ---------------------------------------------------------------------------

describe('Generic convention — output.value as JSON message array', () => {
  // GENERIC_TRACE_RESPONSE uses this pattern: output.value is a JSON array of messages.
  // This verifies the same data path the fixture exercises but as a targeted unit test.
  const inputJson = JSON.stringify([
    { role: 'system', content: 'You are a code review assistant.' },
    { role: 'user', content: 'Review this function for bugs.' },
  ]);
  const outputJson = JSON.stringify([
    { role: 'assistant', content: 'The function looks correct. Consider adding null checks on line 5.' },
  ]);
  const tags: KeyValuePair[] = [
    kv('operation.type', 'chat_completion'),
    kv('model', 'my-custom-llm-v2'),
    kv('temperature', 0.8),
    kv('max_tokens', 256),
    kv('input.value', inputJson),
    kv('output.value', outputJson),
    kv('prompt_tokens', 38),
    kv('completion_tokens', 22),
    kv('total_tokens', 60),
    kv('finish_reason', 'stop'),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.convention, 'generic', 'convention = generic');
  assertEquals(result.isLlm, true, 'isLlm = true');
  assertEquals(result.model, 'my-custom-llm-v2', 'model extracted');
  assertEquals(result.inputMessages.length, 2, 'two input messages');
  assertEquals(result.inputMessages[0].role, 'system', 'system message role');
  assertEquals(result.inputMessages[1].role, 'user', 'user message role');
  assertEquals(result.outputMessages.length, 1, 'one output message');
  assertEquals(result.outputMessages[0].role, 'assistant', 'assistant output role');
  assertEquals(result.outputMessages[0].content, 'The function looks correct. Consider adding null checks on line 5.', 'output content');
  assertEquals(result.tokenUsage.input, 38, 'prompt_tokens');
  assertEquals(result.tokenUsage.output, 22, 'completion_tokens');
  assertEquals(result.tokenUsage.total, 60, 'total_tokens');
  assertEquals(result.finishReason, 'stop', 'finish_reason extracted');
  assertEquals(result.invocationParams.temperature, 0.8, 'temperature');
  assertEquals(result.invocationParams.maxTokens, 256, 'maxTokens');
});

// ---------------------------------------------------------------------------
// 18. OTel GenAI — gen_ai.response.model preference over gen_ai.request.model
//     (fix: response.model now takes priority since that is what was actually served)
// ---------------------------------------------------------------------------

describe('OTel GenAI — gen_ai.response.model takes priority over gen_ai.request.model', () => {
  // A common streaming scenario: the request asked for 'gpt-4' but the provider
  // routed to / confirmed 'gpt-4-0613' in the response headers.
  const tags: KeyValuePair[] = [
    kv('gen_ai.system', 'openai'),
    kv('gen_ai.request.model', 'gpt-4'),
    kv('gen_ai.response.model', 'gpt-4-0613'),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.convention, 'otel-genai', 'convention = otel-genai');
  assertEquals(result.model, 'gpt-4-0613', 'gen_ai.response.model wins over gen_ai.request.model');
});

describe('OTel GenAI — gen_ai.request.model used when response.model absent', () => {
  const tags: KeyValuePair[] = [
    kv('gen_ai.system', 'anthropic'),
    kv('gen_ai.request.model', 'claude-3-opus'),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.model, 'claude-3-opus', 'request.model used when response.model absent');
});

describe('OTel GenAI — gen_ai.response.model used when request.model absent', () => {
  // Some instrumentation only records the response model (e.g. after streaming completes).
  const tags: KeyValuePair[] = [
    kv('gen_ai.system', 'openai'),
    kv('gen_ai.response.model', 'gpt-4o-2024-08-06'),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.model, 'gpt-4o-2024-08-06', 'response.model used when request.model absent');
});

// ---------------------------------------------------------------------------
// 19. OTel GenAI — gen_ai.request.top_k and other less-common params are surfaced
//     (fix: these were previously silently dropped from invocationParams)
// ---------------------------------------------------------------------------

describe('OTel GenAI — gen_ai.request.top_k is included in invocationParams', () => {
  // top_k is used by Anthropic (claude), Gemini and others; it was not previously extracted.
  const tags: KeyValuePair[] = [
    kv('gen_ai.system', 'anthropic'),
    kv('gen_ai.request.model', 'claude-3-sonnet'),
    kv('gen_ai.request.temperature', 0.7),
    kv('gen_ai.request.top_p', 0.9),
    kv('gen_ai.request.top_k', 40),
    kv('gen_ai.request.max_tokens', 1024),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.convention, 'otel-genai', 'convention = otel-genai');
  assertEquals(result.invocationParams.temperature, 0.7, 'temperature present');
  assertEquals(result.invocationParams.topP, 0.9, 'topP present');
  assertEquals(result.invocationParams.maxTokens, 1024, 'maxTokens present');
  assertEquals((result.invocationParams as any).topK, 40, 'topK extracted from gen_ai.request.top_k');
});

describe('OTel GenAI — gen_ai.request.frequency_penalty and presence_penalty extracted', () => {
  const tags: KeyValuePair[] = [
    kv('gen_ai.system', 'openai'),
    kv('gen_ai.request.model', 'gpt-4o'),
    kv('gen_ai.request.frequency_penalty', 0.5),
    kv('gen_ai.request.presence_penalty', 0.3),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals((result.invocationParams as any).frequencyPenalty, 0.5, 'frequencyPenalty from gen_ai.request.frequency_penalty');
  assertEquals((result.invocationParams as any).presencePenalty, 0.3, 'presencePenalty from gen_ai.request.presence_penalty');
});

describe('OTel GenAI — gen_ai.operation.name exposed in invocationParams', () => {
  // gen_ai.operation.name is the primary span identifier set by opentelemetry-instrumentation-openai.
  // It should be surfaced so the UI can show it (e.g. "chat", "embeddings", "completions").
  const tags: KeyValuePair[] = [
    kv('gen_ai.system', 'openai'),
    kv('gen_ai.operation.name', 'chat'),
    kv('gen_ai.request.model', 'gpt-4o-mini'),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.convention, 'otel-genai', 'convention = otel-genai');
  assertEquals((result.invocationParams as any).operationName, 'chat', 'operationName from gen_ai.operation.name');
});

describe('OTel GenAI — optional params absent means they are not injected into invocationParams', () => {
  // When optional attributes are not present, they must not appear in the params object
  // (do not inject undefined values — they clutter the UI with empty rows).
  const tags: KeyValuePair[] = [
    kv('gen_ai.system', 'openai'),
    kv('gen_ai.request.model', 'gpt-4o'),
    kv('gen_ai.request.temperature', 0.5),
  ];
  const result = extractLlmSpanData(tags, []);
  assert(!('topK' in result.invocationParams), 'topK absent when gen_ai.request.top_k not set');
  assert(!('frequencyPenalty' in result.invocationParams), 'frequencyPenalty absent when not set');
  assert(!('operationName' in result.invocationParams), 'operationName absent when not set');
});

// ---------------------------------------------------------------------------
// 20. detectConvention — gen_ai.operation.name without gen_ai.system is still otel-genai
//     (opentelemetry-instrumentation-openai sets gen_ai.operation.name on all LLM spans)
// ---------------------------------------------------------------------------

describe('detectConvention — span with only gen_ai.operation.name is detected as otel-genai', () => {
  // opentelemetry-instrumentation-openai sets gen_ai.operation.name without gen_ai.system
  // on some versions. The span must still be detected as an LLM span.
  const tags: KeyValuePair[] = [
    kv('gen_ai.operation.name', 'chat'),
    kv('gen_ai.request.model', 'gpt-4o'),
  ];
  const result = extractLlmSpanData(tags, []);
  // gen_ai.request.model starts with "gen_ai." so detectConvention returns otel-genai
  assertEquals(result.convention, 'otel-genai', 'gen_ai.operation.name span detected as otel-genai');
  assertEquals(result.isLlm, true, 'isLlm = true');
  assertEquals(result.model, 'gpt-4o', 'model extracted');
});

// ---------------------------------------------------------------------------
// BUG-001: isLlmSpan() should return true for GUARDRAIL spans
// ---------------------------------------------------------------------------

describe('BUG-001: isLlmSpan returns true for GUARDRAIL spans', () => {
  assert(isLlmSpan([kv('openinference.span.kind', 'GUARDRAIL')]), 'GUARDRAIL kind is an LLM span');
  assert(isLlmSpan([kv('openinference.span.kind', 'guardrail')]), 'lowercase guardrail is an LLM span');
  assert(!isLlmSpan([kv('openinference.span.kind', 'CHAIN')]), 'CHAIN is still not an LLM span');
  assert(!isLlmSpan([kv('openinference.span.kind', 'TOOL')]), 'TOOL is still not an LLM span');
});

// ---------------------------------------------------------------------------
// BUG-002: isEmbeddingSpan() checks gen_ai.operation.name
// ---------------------------------------------------------------------------

describe('BUG-002: isEmbeddingSpan checks gen_ai.operation.name', () => {
  assert(isEmbeddingSpan([kv('gen_ai.operation.name', 'embeddings')]), 'gen_ai.operation.name=embeddings is embedding');
  assert(isEmbeddingSpan([kv('gen_ai.operation.name', 'create_embeddings')]), 'gen_ai.operation.name=create_embeddings is embedding');
  assert(isEmbeddingSpan([kv('gen_ai.operation.name', 'embed')]), 'gen_ai.operation.name=embed is embedding');
  assert(!isEmbeddingSpan([kv('gen_ai.operation.name', 'chat')]), 'gen_ai.operation.name=chat is NOT embedding');
  assert(isEmbeddingSpan([kv('llm.request.type', 'embedding')]), 'llm.request.type still works');
  // isLlmSpan returns false for embedding spans
  assert(!isLlmSpan([kv('gen_ai.operation.name', 'embeddings'), kv('llm.model_name', 'text-embedding-3')]), 'embedding span is not an LLM span');
});

// ---------------------------------------------------------------------------
// BUG-003: detectConvention — llm.model_name check before llm.prompts.*
//          Traceloop spans with llm.model_name must be openinference, not vertex
// ---------------------------------------------------------------------------

describe('BUG-003: llm.model_name takes priority over llm.prompts.* for convention detection', () => {
  // A span with llm.model_name AND llm.prompts.* (Traceloop-style) should be openinference
  const tags: KeyValuePair[] = [
    kv('llm.model_name', 'gpt-4o'),
    kv('llm.prompts.0.role', 'user'),
    kv('llm.prompts.0.content', 'Hello'),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.convention, 'openinference', 'llm.model_name wins: convention = openinference not vertex');
  assertEquals(result.model, 'gpt-4o', 'model extracted correctly');
});

describe('BUG-003: llm.input_messages.* takes priority over llm.prompts.* for convention detection', () => {
  const tags: KeyValuePair[] = [
    kv('llm.input_messages.0.message.role', 'user'),
    kv('llm.input_messages.0.message.content', 'Hello'),
    kv('llm.prompts.0.role', 'user'),
    kv('llm.prompts.0.content', 'Should not affect convention'),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.convention, 'openinference', 'llm.input_messages.* wins: convention = openinference');
});

describe('BUG-003 regression: Traceloop span with gen_ai.system + llm.request.type uses otel-genai, not openinference', () => {
  // Traceloop emits both llm.request.type AND gen_ai.system + gen_ai.prompt.* on the same span.
  // gen_ai.system must win: the span is otel-genai so gen_ai.prompt.* messages are extracted.
  const tags: KeyValuePair[] = [
    kv('gen_ai.system', 'openai'),
    kv('gen_ai.request.model', 'gpt-4.1'),
    kv('llm.request.type', 'chat'),
    kv('gen_ai.prompt.0.role', 'system'),
    kv('gen_ai.prompt.0.content', 'You are helpful.'),
    kv('gen_ai.prompt.1.role', 'user'),
    kv('gen_ai.prompt.1.content', 'Hello'),
    kv('gen_ai.completion.0.role', 'assistant'),
    kv('gen_ai.completion.0.content', 'Hi there!'),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.convention, 'otel-genai', 'gen_ai.system=openai wins over llm.request.type: convention = otel-genai');
  assertEquals(result.inputMessages.length, 2, 'both gen_ai.prompt messages extracted');
  assertEquals(result.inputMessages[0].role, 'system', 'system message extracted');
  assertEquals(result.inputMessages[1].role, 'user', 'user message extracted');
  assertEquals(result.outputMessages.length, 1, 'gen_ai.completion message extracted');
  assertEquals(result.outputMessages[0].content, 'Hi there!', 'assistant content correct');
});

// ---------------------------------------------------------------------------
// BUG-008/BUG-046: looksLikeMessages should NOT match "message" field
// ---------------------------------------------------------------------------

describe('BUG-008: looksLikeMessages does not trigger on "message" field (only "content")', () => {
  // A JSON with "role" and "message" but no "content" should NOT be treated as messages
  const withMessageField = JSON.stringify([{ role: 'user', message: 'hello world this is long enough' }]);
  const tags: KeyValuePair[] = [
    kv('operation.type', 'chat_completion'),
    kv('input.value', withMessageField),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.inputMessages.length, 0, '"message" field without "content" does not produce messages');

  // A JSON with "role" and "content" SHOULD still be treated as messages
  const withContentField = JSON.stringify([{ role: 'user', content: 'hello world this is long enough' }]);
  const tags2: KeyValuePair[] = [
    kv('operation.type', 'chat_completion'),
    kv('input.value', withContentField),
  ];
  const result2 = extractLlmSpanData(tags2, []);
  assertEquals(result2.inputMessages.length, 1, '"content" field still produces messages');
});

// ---------------------------------------------------------------------------
// BUG-016: decodeUnicodeEscapes handles surrogate pairs (emoji)
// ---------------------------------------------------------------------------

describe('BUG-016: decodeUnicodeEscapes handles surrogate pairs for emoji', () => {
  // Import decodeUnicodeEscapes via extractLlmSpanData by putting emoji in content
  // 😀 = U+1F600, encoded as surrogate pair \uD83D\uDE00
  const tags: KeyValuePair[] = [
    kv('openinference.span.kind', 'LLM'),
    kv('llm.model_name', 'gpt-4'),
    kv('llm.input_messages.0.message.role', 'user'),
    kv('llm.input_messages.0.message.content', 'Hello \\uD83D\\uDE00 world'),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.inputMessages[0].content, 'Hello 😀 world', 'surrogate pair decoded to emoji');
});

describe('BUG-016: decodeUnicodeEscapes handles regular BMP unicode (non-surrogate)', () => {
  const tags: KeyValuePair[] = [
    kv('openinference.span.kind', 'LLM'),
    kv('llm.model_name', 'gpt-4'),
    kv('llm.input_messages.0.message.role', 'user'),
    kv('llm.input_messages.0.message.content', '\\u82f1\\u8a9e'),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.inputMessages[0].content, '英語', 'BMP unicode escapes decoded');
});

// ---------------------------------------------------------------------------
// BUG-027: extractOpenInference parses Python repr invocation_parameters
// ---------------------------------------------------------------------------

describe('BUG-027: invocation_parameters with Python repr format (single quotes, True/False/None)', () => {
  const tags: KeyValuePair[] = [
    kv('openinference.span.kind', 'LLM'),
    kv('llm.model_name', 'gpt-4'),
    kv('llm.invocation_parameters', "{'temperature': 0.7, 'max_tokens': 512, 'stream': True, 'stop': None}"),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals((result.invocationParams as any).temperature, 0.7, 'temperature parsed from Python repr');
  assertEquals((result.invocationParams as any).max_tokens, 512, 'max_tokens parsed from Python repr');
  assertEquals((result.invocationParams as any).stream, true, 'True converted to true');
  assertEquals((result.invocationParams as any).stop, null, 'None converted to null');
});

describe('BUG-027: invocation_parameters falls back to gen_ai.request.* when completely unparseable', () => {
  const tags: KeyValuePair[] = [
    kv('openinference.span.kind', 'LLM'),
    kv('llm.model_name', 'gpt-4'),
    kv('llm.invocation_parameters', 'totally unparseable string !!!'),
    kv('gen_ai.request.temperature', 0.5),
    kv('gen_ai.request.max_tokens', 256),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.invocationParams.temperature, 0.5, 'temperature fallback from gen_ai.request.temperature');
  assertEquals(result.invocationParams.maxTokens, 256, 'maxTokens fallback from gen_ai.request.max_tokens');
});

// ---------------------------------------------------------------------------
// BUG-028: extractOtelGenAi checks native array for finish reasons
// ---------------------------------------------------------------------------

describe('BUG-028: finish reason from native array attribute gen_ai.response.finish_reasons', () => {
  const tags: KeyValuePair[] = [
    kv('gen_ai.system', 'openai'),
    kv('gen_ai.request.model', 'gpt-4'),
    kv('gen_ai.response.finish_reasons', JSON.stringify(['stop'])),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.finishReason, 'stop', 'finish reason extracted from native array attribute');
});

describe('BUG-028: dotted path gen_ai.response.finish_reasons.0 still works', () => {
  const tags: KeyValuePair[] = [
    kv('gen_ai.system', 'openai'),
    kv('gen_ai.request.model', 'gpt-4'),
    kv('gen_ai.response.finish_reasons.0', 'length'),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.finishReason, 'length', 'dotted path finish reason still works');
});

// ---------------------------------------------------------------------------
// BUG-029: getAttr returns undefined (not "null") when tag.value === null
// ---------------------------------------------------------------------------

describe('BUG-029: getAttr returns undefined when tag.value is null', () => {
  const tags: KeyValuePair[] = [
    kv('openinference.span.kind', 'LLM'),
    kv('llm.model_name', null),
  ];
  const result = extractLlmSpanData(tags, []);
  // model should fall through to 'unknown' since llm.model_name is null
  assertEquals(result.model, 'unknown', 'null tag value produces undefined, falls through to unknown');
});

// ---------------------------------------------------------------------------
// BUG-030: extractIndexedMessages handles object content (not [object Object])
// ---------------------------------------------------------------------------

describe('BUG-030: extractIndexedMessages serializes object content to JSON', () => {
  const multiModalContent = [{ type: 'text', text: 'hello' }, { type: 'image_url', url: 'http://x.com/img.png' }];
  const tags: KeyValuePair[] = [
    kv('openinference.span.kind', 'LLM'),
    kv('llm.model_name', 'gpt-4o'),
    kv('llm.input_messages.0.message.role', 'user'),
    kv('llm.input_messages.0.message.content', multiModalContent),
  ];
  const result = extractLlmSpanData(tags, []);
  assert(result.inputMessages[0].content !== '[object Object]', 'content is not [object Object]');
  assert(result.inputMessages[0].content.includes('"type"'), 'object content is JSON stringified');
});

// ---------------------------------------------------------------------------
// BUG-032: single-object JSON branch in extractMessagesFromJsonValue includes toolCalls
// ---------------------------------------------------------------------------

describe('BUG-032: single-object message includes toolCalls', () => {
  const singleWithToolCalls = JSON.stringify({
    role: 'assistant',
    content: '',
    tool_calls: [{ function: { name: 'search', arguments: '{"q":"test"}' }, id: 'call_1' }],
  });
  const tags: KeyValuePair[] = [
    kv('operation.type', 'chat_completion'),
    kv('input.value', singleWithToolCalls),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.inputMessages.length, 1, 'single object message extracted');
  assert(Array.isArray(result.inputMessages[0].toolCalls), 'toolCalls is array');
  assertEquals(result.inputMessages[0].toolCalls?.[0].name, 'search', 'tool call name preserved');
});

// ---------------------------------------------------------------------------
// BUG-033: double-encoded JSON strings in events are handled
// ---------------------------------------------------------------------------

describe('BUG-033: double-encoded JSON content in gen_ai events is decoded', () => {
  const innerContent = JSON.stringify([{ role: 'user', content: 'inner message' }]);
  const doubleEncoded = JSON.stringify(innerContent); // wrap again as JSON string
  const tags: KeyValuePair[] = [
    kv('gen_ai.system', 'openai'),
    kv('gen_ai.request.model', 'gpt-4'),
  ];
  const logs: SpanLog[] = [
    log('gen_ai.content.prompt', [
      kv('gen_ai.prompt', doubleEncoded),
    ]),
  ];
  const result = extractLlmSpanData(tags, logs);
  assertEquals(result.inputMessages.length, 1, 'double-encoded JSON messages decoded');
  assertEquals(result.inputMessages[0].content, 'inner message', 'inner message content extracted');
  assertEquals(result.inputMessages[0].role, 'user', 'inner message role extracted');
});

// ---------------------------------------------------------------------------
// BUG-045: extractOpenInference checks gen_ai.response.model first
// ---------------------------------------------------------------------------

describe('BUG-045: extractOpenInference uses gen_ai.response.model over llm.model_name', () => {
  const tags: KeyValuePair[] = [
    kv('openinference.span.kind', 'LLM'),
    kv('llm.model_name', 'gpt-4'),
    kv('gen_ai.response.model', 'gpt-4-turbo-2024-04-09'),
    kv('gen_ai.request.model', 'gpt-4-turbo'),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.model, 'gpt-4-turbo-2024-04-09', 'gen_ai.response.model takes first priority in openinference');
});

// ---------------------------------------------------------------------------
// BUG-047 + BUG-079: getNumAttr returns undefined for null and empty string
// ---------------------------------------------------------------------------

describe('BUG-047: getNumAttr returns undefined for null tag value', () => {
  const tags: KeyValuePair[] = [
    kv('openinference.span.kind', 'LLM'),
    kv('llm.model_name', 'gpt-4'),
    kv('llm.token_count.prompt', null),
    kv('llm.token_count.completion', undefined),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.tokenUsage.input, undefined, 'null token count returns undefined (not 0)');
  assertEquals(result.tokenUsage.output, undefined, 'undefined token count returns undefined');
});

describe('BUG-079: getNumAttr returns undefined for empty/whitespace string', () => {
  const tags: KeyValuePair[] = [
    kv('openinference.span.kind', 'LLM'),
    kv('llm.model_name', 'gpt-4'),
    kv('llm.token_count.prompt', ''),
    kv('llm.token_count.completion', '   '),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.tokenUsage.input, undefined, 'empty string token count returns undefined');
  assertEquals(result.tokenUsage.output, undefined, 'whitespace string token count returns undefined');
});

// ---------------------------------------------------------------------------
// BUG-080: getAttr returns undefined for null tag value (doesn't return "null" string)
// ---------------------------------------------------------------------------

describe('BUG-080: getAttr returns undefined (not "null") for null values — detectConvention unaffected', () => {
  // If openinference.span.kind === null, detectConvention must NOT treat it as openinference
  const tags: KeyValuePair[] = [
    kv('openinference.span.kind', null),
    kv('gen_ai.system', 'openai'),
    kv('gen_ai.request.model', 'gpt-4'),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.convention, 'otel-genai', 'null openinference.span.kind does not force openinference convention');
});

// ---------------------------------------------------------------------------
// BUG-081: extractGcpVertex*Messages handles functionCall/functionResponse parts
// ---------------------------------------------------------------------------

describe('BUG-081: extractGcpVertexResponseMessages includes functionCall parts', () => {
  const llmResponse = JSON.stringify({
    candidates: [{
      content: {
        role: 'model',
        parts: [
          { functionCall: { name: 'getWeather', args: { city: 'Paris' } } },
        ],
      },
    }],
  });
  const tags: KeyValuePair[] = [
    kv('gen_ai.system', 'vertex_ai'),
    kv('gcp.vertex.agent.llm_response', llmResponse),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.outputMessages.length, 1, 'one output message');
  assertEquals(result.outputMessages[0].content, '', 'function call is not duplicated as prose');
  assertEquals(result.outputMessages[0].parts?.[0]?.type, 'tool_call', 'functionCall becomes a tool call part');
  assertEquals(result.outputMessages[0].toolCalls?.[0]?.name, 'getWeather', 'functionCall name is preserved');
});

describe('BUG-081: extractGcpVertexRequestMessages includes functionResponse parts', () => {
  const llmRequest = JSON.stringify({
    contents: [{
      role: 'user',
      parts: [
        { functionResponse: { name: 'getWeather', response: { temperature: '22C' } } },
      ],
    }],
  });
  const tags: KeyValuePair[] = [
    kv('gen_ai.system', 'vertex_ai'),
    kv('gcp.vertex.agent.llm_request', llmRequest),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.inputMessages.length, 1, 'one input message');
  assertEquals(result.inputMessages[0].content, '', 'function response is not duplicated as prose');
  const responsePart = result.inputMessages[0].parts?.[0];
  assertEquals(responsePart?.type, 'tool_result', 'functionResponse becomes a tool result part');
  assertEquals(responsePart?.type === 'tool_result' ? responsePart.name : undefined, 'getWeather', 'functionResponse name is preserved');
});

// ---------------------------------------------------------------------------
// BUG-082: extractIndexedMessages defaults missing role to 'user'
// ---------------------------------------------------------------------------

describe('BUG-082: extractIndexedMessages defaults empty role to user', () => {
  const tags: KeyValuePair[] = [
    kv('openinference.span.kind', 'LLM'),
    kv('llm.model_name', 'gpt-4'),
    kv('llm.input_messages.0.message.content', 'message with no role'),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.inputMessages.length, 1, 'message extracted even without role');
  assertEquals(result.inputMessages[0].role, 'user', 'missing role defaults to user');
  assertEquals(result.inputMessages[0].content, 'message with no role', 'content preserved');
});

// ---------------------------------------------------------------------------
// BUG-083: extractMessagesFromEvents accumulates gen_ai.choice events by index
// ---------------------------------------------------------------------------

describe('BUG-083: gen_ai.choice streaming events are accumulated by index', () => {
  const tags: KeyValuePair[] = [
    kv('gen_ai.system', 'openai'),
    kv('gen_ai.request.model', 'gpt-4'),
  ];
  const logs: SpanLog[] = [
    log('gen_ai.choice', [kv('gen_ai.content', 'Hello'), kv('gen_ai.choice.index', '0')]),
    log('gen_ai.choice', [kv('gen_ai.content', ', world'), kv('gen_ai.choice.index', '0')]),
    log('gen_ai.choice', [kv('gen_ai.content', '!'), kv('gen_ai.choice.index', '0')]),
  ];
  const result = extractLlmSpanData(tags, logs);
  assertEquals(result.outputMessages.length, 1, 'streaming chunks accumulated into one message');
  assertEquals(result.outputMessages[0].content, 'Hello, world!', 'chunks concatenated in order');
});

describe('BUG-083: multiple gen_ai.choice indices produce separate messages', () => {
  const tags: KeyValuePair[] = [
    kv('gen_ai.system', 'openai'),
    kv('gen_ai.request.model', 'gpt-4'),
  ];
  const logs: SpanLog[] = [
    log('gen_ai.choice', [kv('gen_ai.content', 'Choice A'), kv('gen_ai.choice.index', '0')]),
    log('gen_ai.choice', [kv('gen_ai.content', 'Choice B'), kv('gen_ai.choice.index', '1')]),
  ];
  const result = extractLlmSpanData(tags, logs);
  assertEquals(result.outputMessages.length, 2, 'two separate output messages for two indices');
  assertEquals(result.outputMessages[0].content, 'Choice A', 'index 0 content correct');
  assertEquals(result.outputMessages[1].content, 'Choice B', 'index 1 content correct');
});

// ---------------------------------------------------------------------------
// BUG-084: single-object content uses ?? instead of || (preserves falsy "0")
// ---------------------------------------------------------------------------

describe('BUG-084: single-object message content uses ?? (preserves 0 / false-y content)', () => {
  const singleWithZeroContent = JSON.stringify({ role: 'assistant', content: 0 });
  const tags: KeyValuePair[] = [
    kv('operation.type', 'chat_completion'),
    kv('input.value', singleWithZeroContent),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.inputMessages.length, 1, 'message extracted');
  assertEquals(result.inputMessages[0].content, '0', 'content "0" preserved (not replaced by text field)');
});

describe('BUG-084: single-object message with content="" uses ?? (empty string kept)', () => {
  const singleWithEmpty = JSON.stringify({ role: 'assistant', content: '', text: 'fallback text' });
  const tags: KeyValuePair[] = [
    kv('operation.type', 'chat_completion'),
    kv('input.value', singleWithEmpty),
  ];
  const result = extractLlmSpanData(tags, []);
  assertEquals(result.inputMessages.length, 1, 'message extracted');
  assertEquals(result.inputMessages[0].content, '', 'empty content kept with ??, not overridden by text');
});

// ---------------------------------------------------------------------------
// Structured OpenInference messages
// ---------------------------------------------------------------------------

describe('OpenInference structured messages', () => {
  const tags: KeyValuePair[] = [
    kv('openinference.span.kind', 'LLM'),
    kv('llm.model_name', 'claude-sonnet-4-5'),
    kv('llm.input_messages.1.message.role', 'user'),
    kv('llm.input_messages.1.message.contents.0.message_content.type', 'text'),
    kv('llm.input_messages.1.message.contents.0.message_content.text', '## User - **Name:** example_user'),
    kv('llm.input_messages.2.message.role', 'user'),
    kv('llm.input_messages.2.message.contents.0.message_content.type', 'text'),
    kv('llm.input_messages.2.message.contents.0.message_content.text', 'Please look into ticket PROJ-123'),
    kv('llm.output_messages.0.message.role', 'assistant'),
    kv('llm.output_messages.0.message.tool_calls.0.tool_call.id', 'tooluse_example0001'),
    kv('llm.output_messages.0.message.tool_calls.0.tool_call.function.name', 'transfer_to_agent'),
    kv('llm.output_messages.0.message.tool_calls.0.tool_call.function.arguments', '{}'),
  ];

  const result = extractLlmSpanData(tags, []);

  assertEquals(result.inputMessages[0].content, '## User - **Name:** example_user', 'first nested user text');
  assertEquals(result.inputMessages[1].content, 'Please look into ticket PROJ-123', 'second nested user text');
  assertEquals(result.inputMessages[0].parts?.[0].type, 'text', 'nested text remains an ordered part');
  assertDeepEquals(result.outputMessages[0].toolCalls, [{
    name: 'transfer_to_agent',
    arguments: '{}',
    id: 'tooluse_example0001',
  }], 'flattened tool call is normalized');
});

describe('OpenInference dotted paths reject prototype-pollution keys', () => {
  const tags: KeyValuePair[] = [
    kv('openinference.span.kind', 'LLM'),
    kv('llm.input_messages.0.message.role', 'user'),
    kv('llm.input_messages.0.message.content', 'safe'),
    kv('llm.input_messages.0.message.__proto__.polluted', 'yes'),
  ];

  const result = extractLlmSpanData(tags, []);

  assertEquals(result.inputMessages[0].content, 'safe', 'safe fields survive a rejected path');
  assertEquals(({} as Record<string, unknown>).polluted, undefined, 'Object prototype remains unchanged');
});

describe('OpenInference ordered multimodal content parts', () => {
  const tags: KeyValuePair[] = [
    kv('openinference.span.kind', 'LLM'),
    kv('llm.input_messages.0.message.role', 'user'),
    kv('llm.input_messages.0.message.contents.0.message_content.type', 'text'),
    kv('llm.input_messages.0.message.contents.0.message_content.text', 'Describe this input.'),
    kv('llm.input_messages.0.message.contents.1.message_content.type', 'image'),
    kv('llm.input_messages.0.message.contents.1.message_content.image.image.url', 'https://example.com/input.png'),
    kv('llm.output_messages.0.message.role', 'assistant'),
    kv('llm.output_messages.0.message.contents.0.message_content.type', 'reasoning'),
    kv('llm.output_messages.0.message.contents.0.message_content.text', 'Inspect the image.'),
    kv('llm.output_messages.0.message.contents.1.message_content.type', 'audio'),
    kv('llm.output_messages.0.message.contents.1.message_content.audio.audio.url', 'https://example.com/reply.wav'),
  ];

  const result = extractLlmSpanData(tags, []);

  assertDeepEquals(result.inputMessages[0].parts?.map((part) => part.type), ['text', 'image'], 'input content-part order');
  assertDeepEquals(result.outputMessages[0].parts?.map((part) => part.type), ['reasoning', 'audio'], 'output content-part order');
  assertEquals(result.inputMessages[0].content, 'Describe this input.', 'only visible text contributes to scalar content');
});

describe('OpenInference ordered tool-use content items', () => {
  const tags: KeyValuePair[] = [
    kv('openinference.span.kind', 'LLM'),
    kv('llm.output_messages.0.message.role', 'assistant'),
    kv('llm.output_messages.0.message.contents.0.message_content.type', 'reasoning'),
    kv('llm.output_messages.0.message.contents.0.message_content.text', 'I need the current weather.'),
    kv('llm.output_messages.0.message.contents.1.message_content.type', 'tool_use'),
    kv('llm.output_messages.0.message.contents.1.tool_call.id', 'call_weather_1'),
    kv('llm.output_messages.0.message.contents.1.tool_call.function.name', 'get_weather'),
    kv('llm.output_messages.0.message.contents.1.tool_call.function.arguments', '{"location":"Sydney"}'),
    kv('llm.output_messages.0.message.contents.2.message_content.type', 'text'),
    kv('llm.output_messages.0.message.contents.2.message_content.text', 'Checking now.'),
    kv('llm.output_messages.0.message.tool_calls.0.tool_call.id', 'call_weather_1'),
    kv('llm.output_messages.0.message.tool_calls.0.tool_call.function.name', 'get_weather'),
    kv('llm.output_messages.0.message.tool_calls.0.tool_call.function.arguments', '{"location":"Sydney"}'),
  ];

  const message = extractLlmSpanData(tags, []).outputMessages[0];

  assertDeepEquals(message.parts?.map((part) => part.type), ['reasoning', 'tool_call', 'text'], 'ordered tool use stays between reasoning and text');
  assertDeepEquals(message.parts?.[1], {
    type: 'tool_call',
    toolCall: { name: 'get_weather', arguments: '{"location":"Sydney"}', id: 'call_weather_1' },
  }, 'ordered tool use reads identity and arguments from the sibling tool_call');
  assertEquals(message.parts?.filter((part) => part.type === 'tool_call').length, 1, 'ordered content contains one tool call');
  assertEquals(message.toolCalls?.length, 1, 'additive conventional tool call remains available once');
});

describe('OpenInference sparse flattened indexes', () => {
  const tags: KeyValuePair[] = [
    kv('openinference.span.kind', 'LLM'),
    kv('llm.output_messages.0.message.role', 'assistant'),
    kv('llm.output_messages.0.message.contents.2.message_content.type', 'text'),
    kv('llm.output_messages.0.message.contents.2.message_content.text', 'After tool calls.'),
    kv('llm.output_messages.0.message.contents.0.message_content.type', 'reasoning'),
    kv('llm.output_messages.0.message.contents.0.message_content.text', 'Plan first.'),
    kv('llm.output_messages.0.message.tool_calls.4.tool_call.id', 'call_4'),
    kv('llm.output_messages.0.message.tool_calls.4.tool_call.function.name', 'fourth_call'),
    kv('llm.output_messages.0.message.tool_calls.4.tool_call.function.arguments', '{}'),
    kv('llm.output_messages.0.message.tool_calls.1.tool_call.id', 'call_1'),
    kv('llm.output_messages.0.message.tool_calls.1.tool_call.function.name', 'first_call'),
    kv('llm.output_messages.0.message.tool_calls.1.tool_call.function.arguments', '{}'),
  ];

  const message = extractLlmSpanData(tags, []).outputMessages[0];

  assertDeepEquals(message.parts?.map((part) => part.type), ['reasoning', 'text'], 'sparse content indexes normalize into dense numeric order');
  assertDeepEquals(message.toolCalls?.map((call) => call.name), ['first_call', 'fourth_call'], 'sparse tool-call indexes normalize into dense numeric order');
});

describe('OpenInference unreasonable flattened indexes are ignored', () => {
  const tags: KeyValuePair[] = [
    kv('openinference.span.kind', 'LLM'),
    kv('llm.output_messages.0.message.role', 'assistant'),
    kv('llm.output_messages.0.message.contents.0.message_content.type', 'text'),
    kv('llm.output_messages.0.message.contents.0.message_content.text', 'Safe content.'),
    kv('llm.output_messages.0.message.contents.100000000.message_content.type', 'text'),
    kv('llm.output_messages.0.message.contents.100000000.message_content.text', 'Unreasonable content.'),
    kv('llm.output_messages.0.message.tool_calls.100000000.tool_call.id', 'huge_call'),
    kv('llm.output_messages.100000000.message.role', 'assistant'),
  ];

  const result = extractLlmSpanData(tags, []);

  assertEquals(result.outputMessages.length, 1, 'unreasonable message index is rejected');
  assertEquals(result.outputMessages[0].content, 'Safe content.', 'reasonable content survives rejected indexes');
  assertEquals(result.outputMessages[0].parts?.length, 1, 'unreasonable content index is rejected');
  assertEquals(result.outputMessages[0].toolCalls, undefined, 'unreasonable tool-call index is rejected');
});

describe('OTel GenAI native structured messages', () => {
  const callId = 'call_VSPygqKTWdrhaFErNvMV18Yl';
  const tags: KeyValuePair[] = [
    kv('gen_ai.system', 'openai'),
    kv('gen_ai.request.model', 'gpt-4o'),
    kv('gen_ai.input.messages', [
      {
        role: 'user',
        parts: [{ type: 'text', content: 'Weather in Paris?' }],
      },
      {
        role: 'assistant',
        parts: [{
          type: 'tool_call',
          id: callId,
          name: 'get_weather',
          arguments: { location: 'Paris' },
        }],
      },
      {
        role: 'tool',
        parts: [{
          type: 'tool_call_response',
          id: callId,
          response: 'rainy, 57F',
        }],
      },
    ]),
    kv('gen_ai.output.messages', [
      {
        role: 'assistant',
        parts: [{ type: 'text', content: 'The weather is rainy.' }],
        finish_reason: 'stop',
      },
    ]),
  ];

  const result = extractLlmSpanData(tags, []);

  assertEquals(result.inputMessages.length, 3, 'three native OTel input messages');
  assertEquals(result.inputMessages[0]?.content, 'Weather in Paris?', 'OTel text content normalized');
  assertEquals(result.inputMessages[1]?.parts?.[0]?.type, 'tool_call', 'OTel tool call part normalized');
  assertDeepEquals(result.inputMessages[1]?.toolCalls, [{
    name: 'get_weather',
    arguments: '{"location":"Paris"}',
    id: callId,
  }], 'OTel tool call compatibility field normalized');
  assertEquals(result.inputMessages[2]?.parts?.[0]?.type, 'tool_result', 'OTel tool response normalized');
  assertEquals(result.outputMessages[0]?.content, 'The weather is rainy.', 'OTel output text normalized');
});

describe('OTel GenAI reasoning and thinking parts render as reasoning', () => {
  const tags: KeyValuePair[] = [
    kv('gen_ai.system', 'anthropic'),
    kv('gen_ai.request.model', 'claude-sonnet-4'),
    kv('gen_ai.output.messages', [
      {
        role: 'assistant',
        parts: [
          { type: 'thinking', content: 'Check the weather tool first.' },
          { type: 'reasoning', content: 'Then summarize.' },
          { type: 'thinking', thinking: 'Anthropic-style field.', signature: 'sig' },
          { type: 'text', content: 'It is rainy.' },
        ],
      },
    ]),
  ];

  const message = extractLlmSpanData(tags, []).outputMessages[0];

  assertDeepEquals(message?.parts?.map((part) => part.type), ['reasoning', 'reasoning', 'reasoning', 'text'], 'thinking and reasoning parts normalize to reasoning');
  const reasoningTexts = message?.parts?.flatMap((part) => (part.type === 'reasoning' ? [part.text] : []));
  assertDeepEquals(reasoningTexts, ['Check the weather tool first.', 'Then summarize.', 'Anthropic-style field.'], 'reasoning text comes from content or thinking');
  assertEquals(message?.content, 'It is rainy.', 'reasoning text stays out of the message content');
});

describe('Vertex function parts preserve camel-case and snake-case variants', () => {
  const request = JSON.stringify({
    contents: [
      {
        role: 'model',
        parts: [{ functionCall: { name: 'lookup_ticket', args: { key: 'PROJ-42' }, id: 'call_1' } }],
      },
      {
        role: 'user',
        parts: [{ function_response: { name: 'lookup_ticket', response: { status: 'open' }, id: 'call_1' } }],
      },
    ],
  });
  const response = JSON.stringify({
    candidates: [{
      content: {
        role: 'model',
        parts: [{ function_call: { name: 'transfer_agent', args: { queue: 'jira' }, id: 'call_2' } }],
      },
    }],
  });
  const tags: KeyValuePair[] = [
    kv('gen_ai.system', 'vertex_ai'),
    kv('gcp.vertex.agent.llm_request', request),
    kv('gcp.vertex.agent.llm_response', response),
  ];

  const result = extractLlmSpanData(tags, []);

  assertEquals(result.inputMessages[0]?.parts?.[0]?.type, 'tool_call', 'Vertex camel-case function call normalized');
  assertEquals(result.inputMessages[0]?.toolCalls?.[0]?.name, 'lookup_ticket', 'Vertex camel-case call name');
  assertEquals(result.inputMessages[0]?.content, '', 'Vertex call is not rendered as annotated prose');
  assertEquals(result.inputMessages[1]?.parts?.[0]?.type, 'tool_result', 'Vertex snake-case function response normalized');
  assertEquals(result.outputMessages[0]?.parts?.[0]?.type, 'tool_call', 'Vertex snake-case function call normalized');
  assertEquals(result.outputMessages[0]?.toolCalls?.[0]?.name, 'transfer_agent', 'Vertex response call name');
});

describe('OpenInference advertised tool definitions', () => {
  const wrapped = {
    type: 'function',
    function: {
      name: 'get_jira_issue',
      description: 'Get one Jira issue.',
      parameters: {
        type: 'object',
        properties: { issue_key: { type: 'string', description: 'Jira issue key.' } },
        required: ['issue_key'],
      },
      strict: false,
    },
  };
  const direct = { type: 'function', name: 'save_memory', parameters: { type: 'object', properties: {} } };
  const result = extractLlmSpanData([
    kv('openinference.span.kind', 'LLM'),
    kv('llm.tools.4.tool.json_schema', JSON.stringify(direct)),
    kv('llm.tools.0.tool.json_schema', JSON.stringify(wrapped)),
    kv('llm.tools.7.tool.json_schema', '{broken'),
  ], []);

  assertEquals(result.tools?.length, 3, 'all OpenInference definitions retained');
  assertDeepEquals(result.tools?.map((tool) => tool.index), [0, 4, 7], 'source indices sorted numerically');
  assertEquals(result.tools?.[0]?.name, 'get_jira_issue', 'wrapped function name normalized');
  assertEquals(result.tools?.[0]?.description, 'Get one Jira issue.', 'description normalized');
  assertEquals(result.tools?.[0]?.strict, false, 'nested strictness normalized');
  assertEquals(result.tools?.[1]?.name, 'save_memory', 'direct definition normalized');
  assertEquals(result.tools?.[2]?.name, 'Invalid tool definition', 'malformed definition labeled');
  assertEquals(result.tools?.[2]?.isValid, false, 'malformed definition retained as invalid');
  assertEquals(result.tools?.[2]?.raw, '{broken', 'malformed raw value preserved');
});

describe('OTel advertised tool definitions accept structured and JSON values', () => {
  const flat = {
    type: 'function',
    name: 'get_weather',
    description: 'Get weather.',
    parameters: { type: 'object', properties: { city: { type: 'string' } } },
  };
  const structured = extractLlmSpanData([
    kv('gen_ai.system', 'openai'),
    kv('gen_ai.tool.definitions', [flat]),
  ], []);
  const encoded = extractLlmSpanData([
    kv('gen_ai.system', 'openai'),
    kv('gen_ai.tool.definitions', JSON.stringify([{ type: 'function', function: flat }])),
  ], []);

  assertEquals(structured.tools?.[0]?.name, 'get_weather', 'structured OTel definition normalized');
  assertEquals(encoded.tools?.[0]?.name, 'get_weather', 'JSON OTel wrapper normalized');
  assertEquals(encoded.tools?.[0]?.index, 0, 'OTel list order retained');
});

describe('Vertex advertised tool definitions accept both declaration key styles', () => {
  const request = JSON.stringify({
    tools: [
      { functionDeclarations: [{ name: 'lookup_ticket', description: 'Look up a ticket.', parameters: { type: 'object' } }] },
      { function_declarations: [{ name: 'transfer_agent', parameters_json_schema: { type: 'object' } }] },
    ],
    contents: [],
  });
  const result = extractLlmSpanData([
    kv('gen_ai.system', 'vertex_ai'),
    kv('gcp.vertex.agent.llm_request', request),
  ], []);

  assertDeepEquals(result.tools?.map((tool) => tool.name), ['lookup_ticket', 'transfer_agent'], 'Vertex declarations normalized in order');
  assertDeepEquals(result.tools?.[1]?.parameters, { type: 'object' }, 'Vertex snake-case parameter schema normalized');
});

describe('structured tool-role text becomes a correlated tool result', () => {
  const result = extractLlmSpanData([
    kv('openinference.span.kind', 'LLM'),
    kv('llm.input_messages.0.message.role', 'tool'),
    kv('llm.input_messages.0.message.tool_call_id', 'call_jira_1'),
    kv('llm.input_messages.0.message.contents.0.message_content.type', 'text'),
    kv('llm.input_messages.0.message.contents.0.message_content.text', '{"key":"PROJ-123"}'),
  ], []);
  const part = result.inputMessages[0].parts?.[0];

  assertEquals(part?.type, 'tool_result', 'tool-role text normalized as a result part');
  assertEquals(part?.type === 'tool_result' ? part.toolCallId : undefined, 'call_jira_1', 'tool result call ID retained');
  assertEquals(part?.type === 'tool_result' ? part.result : undefined, '{"key":"PROJ-123"}', 'tool result text retained');
});

describe('LLM display attribute keys - supported semantic conventions', () => {
  const openInferenceTags = [
    kv('openinference.span.kind', 'LLM'),
    kv('llm.model_name', 'gpt-4o'),
    kv('llm.system', 'openai'),
    kv('llm.input_messages.0.message.role', 'user'),
    kv('llm.input_messages.0.message.content', 'Hello'),
    kv('llm.output_messages.0.message.role', 'assistant'),
    kv('llm.output_messages.0.message.content', 'Hi'),
    kv('llm.tools.0.tool.json_schema', '{"name":"search"}'),
    kv('llm.token_count.prompt', 12),
    kv('llm.request.model', 'unconsumed-model'),
    kv('model', 'unconsumed-model'),
    kv('telemetry.sdk.name', 'openinference'),
  ];
  const openInferenceKeys = getLlmDisplayAttributeKeys(openInferenceTags, extractLlmSpanData(openInferenceTags, []));
  assertDeepEquals(
    Array.from(openInferenceKeys).sort(),
    [
      'llm.input_messages.0.message.content',
      'llm.input_messages.0.message.role',
      'llm.model_name',
      'llm.output_messages.0.message.content',
      'llm.output_messages.0.message.role',
      'llm.system',
      'llm.token_count.prompt',
      'llm.tools.0.tool.json_schema',
      'openinference.span.kind',
    ],
    'OpenInference keys shown in the structured view are identified without unrelated attributes'
  );

  const otelTags = [
    kv('gen_ai.system', 'openai'),
    kv('gen_ai.operation.name', 'chat'),
    kv('gen_ai.request.model', 'gpt-4o'),
    kv('gen_ai.input.messages', [{ role: 'user', content: 'Hello' }]),
    kv('gen_ai.output.messages', [{ role: 'assistant', content: 'Hi' }]),
    kv('gen_ai.tool.definitions', [{ type: 'function', name: 'search' }]),
    kv('gen_ai.request.temperature', 0.2),
    kv('llm.model_name', 'unconsumed-model'),
    kv('model', 'unconsumed-model'),
    kv('gen_ai.response.id', 'response-1'),
  ];
  const otelKeys = getLlmDisplayAttributeKeys(otelTags, extractLlmSpanData(otelTags, []));
  assertDeepEquals(
    Array.from(otelKeys).sort(),
    [
      'gen_ai.input.messages',
      'gen_ai.operation.name',
      'gen_ai.output.messages',
      'gen_ai.request.model',
      'gen_ai.request.temperature',
      'gen_ai.system',
      'gen_ai.tool.definitions',
    ],
    'OTel GenAI keys shown in the structured view are identified without response metadata'
  );

  const vertexTags = [
    kv('gen_ai.system', 'vertex_ai'),
    kv('gen_ai.request.model', 'gemini-2.5-pro'),
    kv('gcp.vertex.agent.llm_request', '{"contents":[{"role":"user","parts":[{"text":"Hello"}]}]}'),
    kv('gcp.vertex.agent.llm_response', '{"candidates":[{"content":{"role":"model","parts":[{"text":"Hi"}]}}]}'),
    kv('gcp.vertex.agent.session_id', 'session-1'),
  ];
  const vertexKeys = getLlmDisplayAttributeKeys(vertexTags, extractLlmSpanData(vertexTags, []));
  assertDeepEquals(
    Array.from(vertexKeys).sort(),
    [
      'gcp.vertex.agent.llm_request',
      'gcp.vertex.agent.llm_response',
      'gen_ai.request.model',
      'gen_ai.system',
    ],
    'Vertex payload keys shown in the structured view are identified without session metadata'
  );

  const unknownTags = [
    kv('http.method', 'POST'),
    kv('input.value', '{"large":"payload"}'),
  ];
  const unknownKeys = getLlmDisplayAttributeKeys(unknownTags, extractLlmSpanData(unknownTags, []));
  assertEquals(unknownKeys.size, 0, 'ordinary spans do not collapse attributes');
});

// ---------------------------------------------------------------------------
// 15. Google ADK spans (gcp.vertex.agent): real LlmRequest / LlmResponse shapes
// ---------------------------------------------------------------------------

describe('Google ADK call_llm - request with config.systemInstruction, config.tools and mixed roles', () => {
  const tags = [
    kv('gen_ai.system', 'gcp.vertex.agent'),
    kv('gen_ai.operation.name', 'call_llm'),
    kv('gen_ai.request.model', 'gemini-2.5-flash'),
    kv('gen_ai.usage.input_tokens', '420'),
    kv('gen_ai.usage.output_tokens', '7'),
    kv('gcp.vertex.agent.llm_request', ADK_LLM_REQUEST),
    kv('gcp.vertex.agent.llm_response', ADK_LLM_RESPONSE),
  ];
  const result = extractLlmSpanData(tags, [], 'call_llm');
  const roles = result.inputMessages.map((m) => m.role);

  assertEquals(result.convention, 'vertex', 'ADK span uses the vertex convention');
  assertEquals(result.isLlm, true, 'ADK call_llm is an LLM span');
  assertDeepEquals(roles, ['system', 'user', 'ag-context', 'model', 'user', 'model', 'user'], 'system, then every content role is kept in order');
  assertEquals(result.inputMessages.length, 7, 'raw JSON with an escaped backslash-u sequence parses and yields every message');
  assertEquals(
    result.inputMessages[0].content,
    'You are a trip planning assistant.\nAnswer travelers in their language, for example Café or Zürich.\nSample code point: A.',
    'system text keeps JSON escapes and decodes the escaped sequence for display'
  );
  assertEquals(
    result.inputMessages[1].content,
    'Find me a flight from Paris to Rome. Destination note: 英語',
    'parsed text holding literal unicode escapes is decoded for display'
  );
  assertEquals(result.inputMessages[2].content, 'Traveler prefers morning departures.', 'custom ag-context role keeps its text');

  const call = result.inputMessages[3].parts?.[0];
  assert(call?.type === 'tool_call' && call.toolCall.name === 'search_flights' && call.toolCall.id === 'adk-call-1', 'model functionCall part becomes a tool_call part');
  assertDeepEquals(
    call?.type === 'tool_call' ? JSON.parse(call.toolCall.arguments) : null,
    { origin: 'CDG', destination: 'FCO' },
    'functionCall args are kept as the tool call arguments'
  );
  const toolResult = result.inputMessages[4].parts?.[0];
  assert(
    toolResult?.type === 'tool_result' && toolResult.toolCallId === 'adk-call-1' && toolResult.name === 'search_flights',
    'user functionResponse part becomes a tool_result part linked by id and name'
  );
  assertEquals(result.inputMessages[5].content, 'Flight FL100 departs at 08:15.', 'model text turn');

  assertDeepEquals(result.tools.map((tool) => tool.name), ['search_flights', 'book_flight'], 'tools come from config.tools[].functionDeclarations');
  assertEquals(result.tools.every((tool) => tool.isValid), true, 'declarations are valid tool definitions');

  assertEquals(result.outputMessages.length, 1, 'response with content (no candidates) yields one output message');
  assertEquals(result.outputMessages[0].role, 'model', 'output role is model');
  assertEquals(result.outputMessages[0].content, 'You are all set for FL100.', 'output text from content.parts');
  assertEquals(result.tokenUsage.input, 420, 'input tokens');
  assertEquals(result.tokenUsage.output, 7, 'output tokens');

  const shown = getLlmDisplayAttributeKeys(tags, result);
  assert(shown.has('gcp.vertex.agent.llm_request'), 'llm_request is listed as shown above');
  assert(shown.has('gcp.vertex.agent.llm_response'), 'llm_response is listed as shown above');
  assert(shown.has('gen_ai.operation.name'), 'operation name behind the kind badge is listed as shown above');
});

describe('Google ADK call_llm - empty text response still produces an output message', () => {
  const tags = [
    kv('gen_ai.system', 'gcp.vertex.agent'),
    kv('gcp.vertex.agent.llm_request', ADK_LLM_REQUEST),
    kv('gcp.vertex.agent.llm_response', ADK_EMPTY_LLM_RESPONSE),
  ];
  const result = extractLlmSpanData(tags, [], 'call_llm');
  assertEquals(result.outputMessages.length, 1, 'one output message for an empty text part');
  assertEquals(result.outputMessages[0].content, '', 'output text is empty');
});

describe('Google ADK - top-level and snake_case request forms are still supported', () => {
  const snakeCase = JSON.stringify({
    config: { system_instruction: 'Be brief.', tools: [{ function_declarations: [{ name: 'lookup', parameters: { type: 'object' } }] }] },
    contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
  });
  const snakeResult = extractLlmSpanData([kv('gen_ai.system', 'gcp.vertex.agent'), kv('gcp.vertex.agent.llm_request', snakeCase)], []);
  assertEquals(snakeResult.inputMessages[0].role, 'system', 'config.system_instruction string becomes the system message');
  assertEquals(snakeResult.inputMessages[0].content, 'Be brief.', 'system string content');
  assertEquals(snakeResult.tools.length, 1, 'config.tools with function_declarations');

  const topLevel = JSON.stringify({
    systemInstruction: { role: 'user', parts: [{ text: 'Top level.' }] },
    tools: [{ functionDeclarations: [{ name: 'lookup' }] }],
    contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
  });
  const topResult = extractLlmSpanData([kv('gen_ai.system', 'gcp.vertex.agent'), kv('gcp.vertex.agent.llm_request', topLevel)], []);
  assertEquals(topResult.inputMessages[0].role, 'system', 'top-level systemInstruction is shown as system even when it carries a user role');
  assertEquals(topResult.inputMessages[0].content, 'Top level.', 'top-level systemInstruction object');
  assertEquals(topResult.tools.length, 1, 'top-level tools');
});

describe('Google ADK execute_tool - arguments and response render as a tool call and result', () => {
  const tags = [
    kv('gen_ai.operation.name', 'execute_tool'),
    kv('gen_ai.tool.name', 'search_flights'),
    kv('gen_ai.tool.call.id', 'adk-call-1'),
    kv('gcp.vertex.agent.llm_request', '{}'),
    kv('gcp.vertex.agent.llm_response', '{}'),
    kv('gcp.vertex.agent.tool_call_args', ADK_TOOL_ARGS),
    kv('gcp.vertex.agent.tool_response', ADK_TOOL_RESPONSE),
  ];
  const result = extractLlmSpanData(tags, [], 'execute_tool search_flights');
  const call = result.inputMessages[0]?.parts?.[0];
  const output = result.outputMessages[0]?.parts?.[0];
  assert(call?.type === 'tool_call' && call.toolCall.name === 'search_flights' && call.toolCall.id === 'adk-call-1', 'tool args become a tool_call input');
  assertEquals(call?.type === 'tool_call' ? call.toolCall.arguments : '', ADK_TOOL_ARGS, 'tool call arguments carry the recorded JSON');
  assert(output?.type === 'tool_result' && output.toolCallId === 'adk-call-1' && output.name === 'search_flights', 'tool response becomes a linked tool_result output');
  assertEquals(result.tools.length, 0, 'placeholder llm_request {} yields no tools');
  assertEquals(isLlmSpan(tags), false, 'execute_tool span is not counted as an LLM span');
  assert(getLlmDisplayAttributeKeys(tags, result).has('gcp.vertex.agent.tool_response'), 'tool_response is listed as shown above');

  const escaped = extractLlmSpanData([
    kv('gen_ai.operation.name', 'execute_tool'),
    kv('gen_ai.tool.name', 'search_flights'),
    kv('gcp.vertex.agent.tool_call_args', '{"city":"Z\\u00fcrich"}'),
    kv('gcp.vertex.agent.tool_response', '{"note":"Caf\\u00e9 and literal \\\\u0041"}'),
  ], []);
  const escapedCall = escaped.inputMessages[0]?.parts?.[0];
  const escapedResult = escaped.outputMessages[0]?.parts?.[0];
  assertEquals(escapedCall?.type === 'tool_call' ? JSON.parse(escapedCall.toolCall.arguments).city : '', 'Zürich', 'tool args keep JSON escapes parseable');
  assertEquals(escapedResult?.type === 'tool_result' ? JSON.parse(String(escapedResult.result)).note : '', 'Café and literal A', 'tool response with an escaped backslash-u parses and is decoded for display');

  const unspecified = extractLlmSpanData([
    kv('gen_ai.operation.name', 'execute_tool'),
    kv('gen_ai.tool.name', 'search_flights'),
    kv('gen_ai.tool.call.id', '<not specified>'),
    kv('gcp.vertex.agent.tool_call_args', ADK_TOOL_ARGS),
    kv('gcp.vertex.agent.tool_response', ADK_TOOL_RESPONSE),
  ], []);
  const unspecifiedCall = unspecified.inputMessages[0]?.parts?.[0];
  assertEquals(unspecifiedCall?.type === 'tool_call' ? unspecifiedCall.toolCall.id : 'missing', undefined, 'the <not specified> placeholder is not used as a call id');
});

describe('Google ADK - content that ADK did not capture is reported, not silently empty', () => {
  const notCaptured = 'Message content was not captured for this span (ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS is disabled).';
  const disabled = extractLlmSpanData([
    kv('gen_ai.system', 'gcp.vertex.agent'),
    kv('gen_ai.operation.name', 'call_llm'),
    kv('gen_ai.request.model', 'gemini-2.5-flash'),
    kv('gen_ai.usage.input_tokens', '420'),
    kv('gen_ai.usage.output_tokens', '7'),
    kv('gcp.vertex.agent.llm_request', '{}'),
    kv('gcp.vertex.agent.llm_response', '{}'),
  ], [], 'call_llm');
  assertDeepEquals(disabled.contentNotices, [notCaptured], 'request and response "{}" give one not-captured notice');
  assertEquals(disabled.inputMessages.length + disabled.outputMessages.length, 0, 'no messages are invented');
  assertEquals(disabled.model, 'gemini-2.5-flash', 'model is still extracted');
  assertEquals(disabled.tokenUsage.input, 420, 'token usage is still extracted');

  const failed = extractLlmSpanData([
    kv('gen_ai.system', 'gcp.vertex.agent'),
    kv('gcp.vertex.agent.llm_request', ADK_SERIALIZATION_ERROR),
    kv('gcp.vertex.agent.llm_response', '<not serializable>'),
  ], []);
  assertDeepEquals(
    failed.contentNotices,
    ['ADK could not serialize the request for this span.', 'ADK could not serialize the response for this span.'],
    'serialization failures are reported per attribute'
  );

  const captured = extractLlmSpanData([
    kv('gen_ai.system', 'gcp.vertex.agent'),
    kv('gcp.vertex.agent.llm_request', ADK_LLM_REQUEST),
    kv('gcp.vertex.agent.llm_response', ADK_LLM_RESPONSE),
  ], []);
  assertEquals(captured.contentNotices, undefined, 'captured content has no notice');

  const toolDisabled = extractLlmSpanData([
    kv('gen_ai.operation.name', 'execute_tool'),
    kv('gen_ai.tool.name', 'search_flights'),
    kv('gcp.vertex.agent.llm_request', '{}'),
    kv('gcp.vertex.agent.llm_response', '{}'),
    kv('gcp.vertex.agent.tool_call_args', '{}'),
    kv('gcp.vertex.agent.tool_response', '{}'),
  ], []);
  assertDeepEquals(toolDisabled.contentNotices, [notCaptured], 'execute_tool with "{}" arguments and response gives the not-captured notice');
  assertEquals(toolDisabled.inputMessages.length + toolDisabled.outputMessages.length, 0, 'no tool cards for uncaptured arguments and response');

  const noArgsTool = extractLlmSpanData([
    kv('gen_ai.operation.name', 'execute_tool'),
    kv('gen_ai.tool.name', 'ping'),
    kv('gcp.vertex.agent.llm_request', '{}'),
    kv('gcp.vertex.agent.llm_response', '{}'),
    kv('gcp.vertex.agent.tool_call_args', '{}'),
    kv('gcp.vertex.agent.tool_response', ADK_TOOL_RESPONSE),
  ], []);
  assertEquals(noArgsTool.contentNotices, undefined, 'a captured tool response with no arguments is not reported');
  assertEquals(noArgsTool.outputMessages.length, 1, 'the captured tool response is still shown');

  const toolFailed = extractLlmSpanData([
    kv('gen_ai.operation.name', 'execute_tool'),
    kv('gen_ai.tool.name', 'search_flights'),
    kv('gcp.vertex.agent.tool_call_args', ADK_TOOL_ARGS),
    kv('gcp.vertex.agent.tool_response', '<not serializable>'),
  ], []);
  assertDeepEquals(toolFailed.contentNotices, ['ADK could not serialize the tool response for this span.'], 'tool response serialization failure is reported');

  const toolError = extractLlmSpanData([
    kv('gen_ai.operation.name', 'execute_tool'),
    kv('gen_ai.tool.name', 'search_flights'),
    kv('gcp.vertex.agent.tool_call_args', ADK_TOOL_ARGS),
    kv('gcp.vertex.agent.tool_response', '{"error":"flight service unavailable"}'),
  ], []);
  assertEquals(toolError.contentNotices, undefined, 'an error returned by the tool itself is tool output, not a serialization failure');

  assertEquals(extractLlmSpanData([kv('gen_ai.system', 'openai'), kv('gen_ai.prompt', '{}')], []).contentNotices, undefined, 'non-ADK spans never get the notice');
});

describe('Google ADK - span kind badges', () => {
  assertEquals(getSpanKind([kv('gen_ai.operation.name', 'call_llm')]), 'LLM', 'call_llm maps to LLM');
  assertEquals(getSpanKind([kv('gen_ai.operation.name', 'generate_content')]), 'LLM', 'generate_content maps to LLM');
  assertEquals(getSpanKind([kv('gen_ai.operation.name', 'execute_tool')]), 'TOOL', 'execute_tool maps to TOOL');
  assertEquals(getSpanKind([kv('gen_ai.operation.name', 'invoke_agent')]), 'AGENT', 'invoke_agent maps to AGENT');
});

describe('getAgentName - attribute and span name conventions', () => {
  assertEquals(getAgentName([kv('gen_ai.agent.name', 'planner')], 'invoke_agent other'), 'planner', 'gen_ai.agent.name wins over the span name');
  assertEquals(getAgentName([kv('agent.name', 'planner'), kv('gen_ai.agent.name', 'router')]), 'router', 'gen_ai.agent.name wins over agent.name');
  assertEquals(getAgentName([kv('agent.name', 'planner')], 'invoke_agent other'), 'planner', 'agent.name wins over the span name');
  assertEquals(getAgentName([], 'invoke_agent travel_planner'), 'travel_planner', 'invoke_agent <name> span name');
  assertEquals(getAgentName([], 'create_agent travel_planner'), 'travel_planner', 'create_agent <name> span name');
  assertEquals(getAgentName([], 'invoke_agent travel planner v2'), 'travel planner v2', 'a name with spaces is kept whole');
  assertEquals(getAgentName([], 'invoke_agent   padded  '), 'padded', 'surrounding whitespace is trimmed');
  assertEquals(getAgentName([], 'invoke_agent'), undefined, 'invoke_agent without a name has no agent name');
  assertEquals(getAgentName([], 'invoke_agent '), undefined, 'invoke_agent followed by blanks has no agent name');
  assertEquals(getAgentName([], 'invoke_agentx foo'), undefined, 'a longer word is not the invoke_agent prefix');
  assertEquals(getAgentName([], 'search_flights'), undefined, 'an ordinary span name has no agent name');
  assertEquals(getAgentName([]), undefined, 'no tags and no span name');
  assertEquals(getAgentName([kv('gen_ai.agent.name', '')], 'invoke_agent planner'), 'planner', 'an empty attribute falls through to the next source');
  assertEquals(getAgentName([kv('gen_ai.agent.name', '  ')], 'invoke_agent planner'), 'planner', 'a blank attribute falls through to the next source');
  assertEquals(getAgentName([kv('gen_ai.agent.name', 'caf\\u00e9')]), 'café', 'unicode escapes in the attribute are decoded');
});

describe('getAgentName - framework attributes', () => {
  // Pydantic AI before instrumentation version 3 records only agent_name on the agent run span.
  assertEquals(getAgentName([kv('agent_name', 'joke_agent')], 'agent run'), 'joke_agent', 'Pydantic AI agent_name');
  assertEquals(getAgentName([kv('agent_name', 'joke_agent'), kv('gen_ai.agent.name', 'router')]), 'router', 'gen_ai.agent.name wins over agent_name');
  assertEquals(getAgentName([kv('agent_name', 'joke_agent'), kv('agent.name', 'planner')]), 'planner', 'agent.name wins over agent_name');
  assertEquals(getAgentName([kv('agent_name', 'joke_agent')], 'invoke_agent other'), 'joke_agent', 'agent_name wins over the span name');
  assertEquals(getAgentName([kv('agent_name', ' ')], 'invoke_agent planner'), 'planner', 'a blank agent_name falls through to the span name');

  // Traceloop @agent spans record the decorated entity's name in traceloop.entity.name.
  assertEquals(getAgentName([kv('traceloop.span.kind', 'agent'), kv('traceloop.entity.name', 'travel_agent')], 'travel_agent.agent'), 'travel_agent', 'Traceloop agent entity name');
  assertEquals(getAgentName([kv('traceloop.span.kind', 'agent'), kv('traceloop.entity.name', 'travel_agent'), kv('gen_ai.agent.name', 'router')]), 'router', 'gen_ai.agent.name wins over the Traceloop entity name');
  assertEquals(getAgentName([kv('traceloop.span.kind', 'tool'), kv('traceloop.entity.name', 'lookup')]), undefined, 'a Traceloop tool entity is not an agent name');
  assertEquals(getAgentName([kv('traceloop.span.kind', 'workflow'), kv('traceloop.entity.name', 'joke_flow')]), undefined, 'a Traceloop workflow entity is not an agent name');
  assertEquals(getAgentName([kv('traceloop.entity.name', 'travel_agent')]), undefined, 'an entity name without the agent span kind is not an agent name');
});

describe('getAgentDescription', () => {
  assertEquals(getAgentDescription([kv('gen_ai.agent.description', 'Plans trips')]), 'Plans trips', 'description attribute');
  assertEquals(getAgentDescription([kv('gen_ai.agent.description', ' ')]), undefined, 'a blank description is none');
  assertEquals(getAgentDescription([]), undefined, 'no description attribute');
});

describe('JSON attribute values are parsed from the raw string, not from decoded text', () => {
  const text = 'Path C:\\users\\unit and literal \\u0041';
  const content = 'Path C:\\users\\unit and literal A';
  const rawMessages = JSON.stringify([{ role: 'user', content: text }]);

  const inputValue = extractLlmSpanData([kv('openinference.span.kind', 'LLM'), kv('input.value', rawMessages)], []);
  assertEquals(inputValue.inputMessages[0]?.content, content, 'input.value JSON with an escaped backslash-u parses and is decoded for display');

  const prompt = extractLlmSpanData([kv('gen_ai.system', 'openai'), kv('gen_ai.prompt', rawMessages)], []);
  assertEquals(prompt.inputMessages[0]?.content, content, 'gen_ai.prompt JSON with an escaped backslash-u parses and is decoded for display');

  const completion = extractLlmSpanData([kv('gen_ai.system', 'openai'), kv('gen_ai.completion', JSON.stringify([{ role: 'assistant', content: text }]))], []);
  assertEquals(completion.outputMessages[0]?.content, content, 'gen_ai.completion JSON with an escaped backslash-u parses and is decoded for display');

  const eventResult = extractLlmSpanData(
    [kv('gen_ai.system', 'openai')],
    [log('gen_ai.content.prompt', [kv('gen_ai.prompt', rawMessages)])]
  );
  assertEquals(eventResult.inputMessages[0]?.content, content, 'event gen_ai.prompt JSON with an escaped backslash-u parses and is decoded for display');

  const params = extractLlmSpanData([kv('openinference.span.kind', 'LLM'), kv('llm.invocation_parameters', '{"temperature":0.5,"stop":"\\\\u0041"}')], []);
  assertEquals((params.invocationParams as any).temperature, 0.5, 'llm.invocation_parameters with an escaped backslash-u parses');

  const asciiEscaped = extractLlmSpanData([kv('openinference.span.kind', 'LLM'), kv('input.value', '[{"role":"user","content":"\\u82f1\\u8a9e"}]')], []);
  assertEquals(asciiEscaped.inputMessages[0]?.content, '英語', 'ensure_ascii escapes inside JSON are still decoded');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

// Ported from public/app/features/explore/TraceView/components/TraceTimelineViewer/SpanDetail/llmUtils.ts
// Extracts LLM span data from OpenInference / OTel GenAI / Vertex AI / generic conventions.

import { formatAttributeValue } from './formatUtils.ts';
import { extractVercelAi, getVercelAiDisplayName, getVercelAiKind, getVercelAiOperation, type FrameworkSpan } from './frameworkAdapters.ts';

export interface KeyValuePair {
  key: string;
  value: unknown;
}

export interface SpanLog {
  timestamp: number;
  name?: string;
  fields: KeyValuePair[];
}

export type LlmMessagePart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string; value?: unknown }
  | { type: 'image' | 'audio'; value: unknown }
  | { type: 'tool_call'; toolCall: LlmToolCall }
  | { type: 'tool_result'; result: unknown; toolCallId?: string; name?: string }
  | { type: 'unknown'; value: unknown };

export interface LlmMessage {
  role: string;
  content: string;
  parts?: LlmMessagePart[];
  toolCalls?: LlmToolCall[];
  toolCallId?: string;
  name?: string;
}

export interface LlmToolCall {
  name: string;
  arguments: string;
  id?: string;
}

export interface LlmToolDefinition {
  index: number;
  type: string;
  name: string;
  description?: string;
  parameters?: unknown;
  strict?: boolean;
  raw: unknown;
  isValid: boolean;
}

// Input tokens include the cached ones and output tokens include reasoning and audio, as the
// OTel GenAI conventions define them. The detail counts are the parts of those totals.
export interface LlmTokenUsage {
  input?: number;
  output?: number;
  total?: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
  audioInput?: number;
  audioOutput?: number;
}

export interface LlmInvocationParams {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  [key: string]: unknown;
}

export type LlmConvention = 'openinference' | 'otel-genai' | 'vertex' | 'generic' | 'unknown';

// Frameworks with their own attribute conventions on top of, or instead of, OTel GenAI.
export type LlmFramework = 'vercel-ai' | 'pydantic-ai' | 'langfuse';

// The instrumentation scope that produced the span (OTLP scopeSpans[].scope).
export interface SpanScope {
  name?: string;
  version?: string;
}

const FRAMEWORK_BY_SCOPE_NAME: Record<string, LlmFramework> = {
  ai: 'vercel-ai',
  'pydantic-ai': 'pydantic-ai',
  'langfuse-sdk': 'langfuse',
};

/**
 * Identifies the framework that emitted a span from its instrumentation scope name.
 * Trace totals are computed without a scope, so detection rules must not depend on it alone.
 */
export function detectFramework(tags: KeyValuePair[], scope?: SpanScope): LlmFramework | undefined {
  const byScope = scope?.name ? FRAMEWORK_BY_SCOPE_NAME[scope.name] : undefined;
  if (byScope) {
    return byScope;
  }
  return getVercelAiOperation(tags) ? 'vercel-ai' : undefined;
}

export interface LlmSpanData {
  isLlm: boolean;
  convention: LlmConvention;
  spanKind?: string; // openinference.span.kind value: LLM, CHAIN, RETRIEVER, TOOL, EMBEDDING, AGENT
  model: string;
  system?: string;
  inputMessages: LlmMessage[];
  outputMessages: LlmMessage[];
  tools: LlmToolDefinition[];
  tokenUsage: LlmTokenUsage;
  invocationParams: LlmInvocationParams;
  finishReason?: string;
  precomputedCostUsd?: number;
  // Explains why a span has no messages even though it is an LLM or tool span (content capture off).
  contentNotices?: string[];
  framework?: LlmFramework;
}

/**
 * Decodes JSON unicode escape sequences (e.g. \u82f1 → 英) that Python tracing SDKs
 * emit when `ensure_ascii=True` (the default). The escapes are stored as literal
 * 6-character sequences in the span attribute string rather than real Unicode code points.
 */
export function decodeUnicodeEscapes(s: string): string {
  // First handle surrogate pairs: \uD800-\uDBFF followed by \uDC00-\uDFFF
  return s
    .replace(/\\u([dD][89aAbB][0-9a-fA-F]{2})\\u([dD][cCdDeEfF][0-9a-fA-F]{2})/g, (_, hi, lo) => {
      const codePoint = 0x10000 + ((parseInt(hi, 16) - 0xD800) << 10) + (parseInt(lo, 16) - 0xDC00);
      return String.fromCodePoint(codePoint);
    })
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
}

function getAttr(tags: KeyValuePair[], key: string): string | undefined {
  const value = getRawAttr(tags, key);
  if (value === null || value === undefined) return undefined;
  return decodeUnicodeEscapes(formatAttributeValue(value));
}

function getRawAttr(tags: KeyValuePair[], key: string): unknown {
  return tags.find((tag) => tag.key === key)?.value;
}

// Attribute text before escape decoding. JSON must be parsed from this form: decoding first turns
// escape sequences such as an escaped backslash followed by "u0041" into invalid JSON.
function getRawStringAttr(tags: KeyValuePair[], key: string): string | undefined {
  const value = getRawAttr(tags, key);
  if (value === null || value === undefined) {
    return undefined;
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function getNumAttr(tags: KeyValuePair[], key: string): number | undefined {
  const tag = tags.find((t) => t.key === key);
  if (tag === undefined) {
    return undefined;
  }
  if (tag.value === null || tag.value === undefined) return undefined;
  if (typeof tag.value === 'string' && tag.value.trim() === '') return undefined;
  const n = Number(tag.value);
  return isNaN(n) ? undefined : n;
}

const USAGE_PREFIXES = ['gen_ai.usage.', 'llm.token_count.'];

// Each token detail has several spellings across instrumentations (OTel GenAI, OpenInference, OpenLLMetry,
// LiteLLM, AI SDK). The first spelling present wins, in this order.
const USAGE_DETAIL_SUFFIXES: Record<'cacheRead' | 'cacheWrite' | 'reasoning' | 'audioInput' | 'audioOutput', string[]> = {
  cacheRead: [
    'cache_read.input_tokens',
    'cache_read_input_tokens',
    'cache_read_tokens',
    'details.cache_read_tokens',
    'details.cache_read_input_tokens',
    'prompt_details.cache_read',
    'input_cached_tokens',
  ],
  cacheWrite: [
    'cache_creation.input_tokens',
    'cache_write.input_tokens',
    'cache_creation_input_tokens',
    'cache_write_tokens',
    'details.cache_write_tokens',
    'details.cache_creation_input_tokens',
    'prompt_details.cache_write',
    'input_cache_creation',
  ],
  reasoning: ['reasoning.output_tokens', 'completion_details.reasoning'],
  audioInput: ['audio.input_tokens', 'prompt_details.audio'],
  audioOutput: ['audio.output_tokens', 'completion_details.audio'],
};
const AI_SDK_USAGE_DETAIL_KEYS: Partial<Record<keyof typeof USAGE_DETAIL_SUFFIXES, string[]>> = {
  cacheRead: ['ai.usage.cachedInputTokens'],
  reasoning: ['ai.usage.reasoningTokens'],
};

function usageDetailKeys(detail: keyof typeof USAGE_DETAIL_SUFFIXES): string[] {
  return [
    ...USAGE_DETAIL_SUFFIXES[detail].flatMap((suffix) => USAGE_PREFIXES.map((prefix) => prefix + suffix)),
    ...(AI_SDK_USAGE_DETAIL_KEYS[detail] ?? []),
  ];
}

function extractTokenDetails(tags: KeyValuePair[]): Omit<LlmTokenUsage, 'input' | 'output' | 'total'> {
  const details: Omit<LlmTokenUsage, 'input' | 'output' | 'total'> = {};
  for (const detail of Object.keys(USAGE_DETAIL_SUFFIXES) as Array<keyof typeof USAGE_DETAIL_SUFFIXES>) {
    for (const key of usageDetailKeys(detail)) {
      const value = getNumAttr(tags, key);
      if (value !== undefined) {
        details[detail] = value;
        break;
      }
    }
  }
  return details;
}

// Costs the instrumentation reported itself, in USD: gen_ai.cost.total_cost, then gen_ai.usage.cost and
// OpenInference's llm.cost.total.
const REPORTED_COST_KEYS = ['gen_ai.cost.total_cost', 'gen_ai.usage.cost', 'llm.cost.total'];

function getReportedCost(tags: KeyValuePair[]): number | undefined {
  for (const key of REPORTED_COST_KEYS) {
    const value = getNumAttr(tags, key);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function looksLikeMessages(value: string): boolean {
  if (!value || value.length < 10) {
    return false;
  }
  return (
    value.includes('"role"') &&
    value.includes('"content"') &&
    (value.startsWith('[') || value.startsWith('{'))
  );
}

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

// Some producers escape twice, so text inside parsed JSON can still contain literal \uXXXX sequences.
// JSON is parsed from the raw attribute first; the resulting display strings are decoded afterwards.
function decodeStrings(value: unknown): unknown {
  if (typeof value === 'string') {
    return decodeUnicodeEscapes(value);
  }
  if (Array.isArray(value)) {
    return value.map(decodeStrings);
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, decodeStrings(entry)]));
  }
  return value;
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') {
    return decodeUnicodeEscapes(value);
  }
  if (value !== null && typeof value === 'object') {
    try {
      return JSON.stringify(decodeStrings(value));
    } catch {
      return '';
    }
  }
  return value === undefined ? '' : String(value);
}

function normalizeToolCall(raw: unknown): LlmToolCall {
  if (!isRecord(raw)) {
    return { name: 'unknown', arguments: '' };
  }
  const toolCall = isRecord(raw.tool_call) ? raw.tool_call : raw;
  const fn = isRecord(toolCall.function) ? toolCall.function : undefined;
  const name = stringifyValue(fn?.name ?? toolCall.name ?? 'unknown');
  const argumentsValue = fn?.arguments ?? toolCall.arguments ?? toolCall.args ?? toolCall.input ?? '';
  const id = toolCall.id ?? toolCall.call_id;
  return {
    name,
    arguments: stringifyValue(argumentsValue),
    id: id === undefined || id === null ? undefined : String(id),
  };
}

function normalizeToolCalls(raw: unknown): LlmToolCall[] | undefined {
  let parsed = raw;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return undefined;
    }
  }
  const calls = getDenseIndexedValues(parsed);
  if (!calls || calls.length === 0) {
    return undefined;
  }
  return calls.map(normalizeToolCall);
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeToolDefinition(raw: unknown, index: number): LlmToolDefinition {
  const parsed = parseJsonValue(raw);
  const outer = isRecord(parsed) ? parsed : undefined;
  const definition = outer && isRecord(outer.function) ? outer.function : outer;
  const validName = definition && typeof definition.name === 'string' && definition.name.trim() !== '';
  const description = definition && typeof definition.description === 'string' ? definition.description : undefined;
  const parameters = definition?.parameters ?? definition?.parameters_json_schema ?? definition?.parametersJsonSchema
    ?? definition?.inputSchema ?? definition?.input_schema;
  const strictValue = definition?.strict ?? outer?.strict;
  return {
    index,
    type: outer && typeof outer.type === 'string' ? outer.type : 'function',
    name: validName ? String(definition.name) : 'Invalid tool definition',
    ...(description !== undefined ? { description } : {}),
    ...(parameters !== undefined ? { parameters } : {}),
    ...(typeof strictValue === 'boolean' ? { strict: strictValue } : {}),
    raw: parsed,
    isValid: Boolean(validName),
  };
}

function extractOpenInferenceToolDefinitions(tags: KeyValuePair[]): LlmToolDefinition[] {
  const definitions: LlmToolDefinition[] = [];
  for (const tag of tags) {
    const match = tag.key.match(/^llm\.tools\.(\d+)\.tool\.json_schema$/);
    if (match) {
      definitions.push(normalizeToolDefinition(tag.value, Number(match[1])));
    }
  }
  return definitions.sort((left, right) => left.index - right.index);
}

function toolDefinitionsFromValue(raw: unknown): LlmToolDefinition[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  const parsed = parseJsonValue(raw);
  const definitions = Array.isArray(parsed) ? parsed : [parsed];
  return definitions.map(normalizeToolDefinition);
}

function extractOtelToolDefinitions(tags: KeyValuePair[]): LlmToolDefinition[] {
  return toolDefinitionsFromValue(getRawAttr(tags, 'gen_ai.tool.definitions'));
}

function extractVertexToolDefinitions(jsonBlob: string | undefined): LlmToolDefinition[] {
  if (!jsonBlob) {
    return [];
  }
  const parsed = parseJsonValue(jsonBlob);
  if (!isRecord(parsed)) {
    return [];
  }
  const config = isRecord(parsed.config) ? parsed.config : {};
  const tools = [config.tools, parsed.tools].flatMap((list) => (Array.isArray(list) ? list : []));
  const definitions: LlmToolDefinition[] = [];
  for (const tool of tools) {
    if (!isRecord(tool)) {
      continue;
    }
    const declarations = tool.functionDeclarations ?? tool.function_declarations;
    if (!Array.isArray(declarations)) {
      continue;
    }
    for (const declaration of declarations) {
      definitions.push(normalizeToolDefinition(decodeStrings(declaration), definitions.length));
    }
  }
  return definitions;
}

function normalizeMessagePart(raw: unknown): LlmMessagePart {
  const wrapper = isRecord(raw) ? raw : undefined;
  const part = wrapper && isRecord(wrapper.message_content) ? wrapper.message_content : raw;
  if (!isRecord(part)) {
    return { type: 'unknown', value: raw };
  }
  const functionCall = isRecord(part.functionCall)
    ? part.functionCall
    : isRecord(part.function_call)
      ? part.function_call
      : undefined;
  if (functionCall) {
    return { type: 'tool_call', toolCall: normalizeToolCall(functionCall) };
  }
  const functionResponse = isRecord(part.functionResponse)
    ? part.functionResponse
    : isRecord(part.function_response)
      ? part.function_response
      : undefined;
  if (functionResponse) {
    const id = functionResponse.id ?? functionResponse.call_id;
    const name = functionResponse.name;
    return {
      type: 'tool_result',
      result: decodeStrings(functionResponse.response ?? functionResponse.result ?? ''),
      toolCallId: id === undefined || id === null ? undefined : String(id),
      name: name === undefined || name === null ? undefined : String(name),
    };
  }
  const type = String(part.type ?? '').toLowerCase();
  if (type === 'text' || (!type && part.text !== undefined)) {
    return { type: 'text', text: stringifyValue(part.text ?? part.content ?? '') };
  }
  // OTel GenAI defines `reasoning`; some instrumentations emit Anthropic-style `thinking` parts instead.
  if (type === 'reasoning' || type === 'thinking') {
    return {
      type: 'reasoning',
      text: stringifyValue(part.text ?? part.content ?? part.thinking ?? ''),
      value: part,
    };
  }
  if (type === 'image' || type === 'audio') {
    return { type, value: part };
  }
  if (type === 'tool_call' || type === 'tool_use') {
    return { type: 'tool_call', toolCall: normalizeToolCall(wrapper ?? part) };
  }
  if (type === 'tool_call_response' || type === 'tool_call_result' || type === 'tool_result') {
    const id = part.id ?? part.call_id ?? part.tool_call_id;
    const name = part.name;
    return {
      type: 'tool_result',
      result: decodeStrings(part.response ?? part.result ?? part.output ?? part.content ?? ''),
      toolCallId: id === undefined || id === null ? undefined : String(id),
      name: name === undefined || name === null ? undefined : String(name),
    };
  }
  return { type: 'unknown', value: part };
}

function firstPresentValue(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in source) {
      return source[key];
    }
  }
  return undefined;
}

const MAX_FLATTENED_LIST_INDEX = 1000;

function getBoundedIndex(value: string): number | undefined {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    return undefined;
  }
  const index = Number(value);
  return Number.isSafeInteger(index) && index <= MAX_FLATTENED_LIST_INDEX ? index : undefined;
}

function getDenseIndexedValues(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value) && !isRecord(value)) {
    return undefined;
  }
  return Object.entries(value)
    .map(([key, entry]) => ({ index: getBoundedIndex(key), entry }))
    .filter((item): item is { index: number; entry: unknown } => item.index !== undefined)
    .sort((left, right) => left.index - right.index)
    .map(({ entry }) => entry);
}

function normalizeMessage(raw: unknown, defaultRole = 'unknown'): LlmMessage | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const source = isRecord(raw.message) ? raw.message : raw;
  const roleValue = firstPresentValue(source, ['role', 'message.role']);
  const role = roleValue === undefined || roleValue === null ? defaultRole : String(roleValue);
  const contentValue = firstPresentValue(source, ['content', 'message.content', 'text']);
  const rawParts = firstPresentValue(source, ['contents', 'parts']);
  const partsValue = getDenseIndexedValues(rawParts) ?? getDenseIndexedValues(contentValue);
  const parts = partsValue?.map(normalizeMessagePart);
  const textFromParts = parts
    ?.filter((part): part is Extract<LlmMessagePart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('') ?? '';
  const content = contentValue === undefined ? textFromParts : stringifyValue(contentValue);
  const messageToolCalls = normalizeToolCalls(firstPresentValue(source, ['tool_calls', 'toolCalls']));
  const partToolCalls = parts
    ?.filter((part): part is Extract<LlmMessagePart, { type: 'tool_call' }> => part.type === 'tool_call')
    .map((part) => part.toolCall);
  const toolCalls = messageToolCalls ?? (partToolCalls && partToolCalls.length > 0 ? partToolCalls : undefined);
  const toolCallIdValue = firstPresentValue(source, ['tool_call_id', 'toolCallId']);
  const nameValue = source.name;
  const toolCallId = toolCallIdValue === undefined || toolCallIdValue === null ? undefined : String(toolCallIdValue);
  const name = nameValue === undefined || nameValue === null ? undefined : String(nameValue);
  const normalizedParts = parts ? [...parts] : [];
  const hasToolResult = normalizedParts.some((part) => part.type === 'tool_result');
  const hasOnlyTextParts = normalizedParts.length > 0 && normalizedParts.every((part) => part.type === 'text');
  if ((role === 'tool' || role === 'function') && !hasToolResult && (normalizedParts.length === 0 || hasOnlyTextParts)) {
    normalizedParts.splice(0, normalizedParts.length, { type: 'tool_result', result: content, toolCallId, name });
  }
  return {
    role,
    content,
    ...(normalizedParts.length > 0 ? { parts: normalizedParts } : {}),
    ...(toolCalls ? { toolCalls } : {}),
    ...(toolCallId ? { toolCallId } : {}),
    ...(name ? { name } : {}),
  };
}

function extractMessagesFromValue(value: unknown): LlmMessage[] {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed === value ? [] : extractMessagesFromValue(parsed);
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) {
    return value
      .map((message) => normalizeMessage(message))
      .filter((message): message is LlmMessage => message !== undefined);
  }
  if (!isRecord(value)) {
    return [];
  }
  const messagesField = value.messages ?? value.Messages ?? value.prompt;
  if (Array.isArray(messagesField)) {
    return messagesField
      .map((message) => normalizeMessage(message))
      .filter((message): message is LlmMessage => message !== undefined);
  }
  if (value.role || value['message.role'] || value.message) {
    const message = normalizeMessage(value);
    return message ? [message] : [];
  }
  return [];
}

function extractMessagesFromJsonValue(value: string): LlmMessage[] {
  return extractMessagesFromValue(value);
}

const DANGEROUS_PATH_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function setNestedValue(target: Record<string, unknown>, path: string[], value: unknown): void {
  let current: Record<string, unknown> | unknown[] = target;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (DANGEROUS_PATH_KEYS.has(key)) {
      return;
    }
    if (/^\d+$/.test(key) && getBoundedIndex(key) === undefined) {
      return;
    }
    const segment = key;
    const container = current as unknown as Record<string | number, unknown>;
    if (container[segment] === undefined) {
      container[segment] = Object.create(null);
    }
    const child = container[segment];
    if (!isRecord(child) && !Array.isArray(child)) {
      return;
    }
    current = child;
  }
  const finalKey = path[path.length - 1];
  if (DANGEROUS_PATH_KEYS.has(finalKey)) {
    return;
  }
  if (/^\d+$/.test(finalKey) && getBoundedIndex(finalKey) === undefined) {
    return;
  }
  const segment = finalKey;
  const container = current as unknown as Record<string | number, unknown>;
  container[segment] = value;
}

function extractIndexedMessages(tags: KeyValuePair[], prefix: string): LlmMessage[] {
  const messages = new Map<number, Record<string, unknown>>();
  for (const tag of tags) {
    if (!tag.key.startsWith(prefix)) {
      continue;
    }
    const rest = tag.key.slice(prefix.length);
    const match = rest.match(/^(\d+)\.(.+)$/);
    if (!match) {
      continue;
    }
    const index = getBoundedIndex(match[1]);
    if (index === undefined) {
      continue;
    }
    if (!messages.has(index)) {
      messages.set(index, Object.create(null));
    }
    setNestedValue(messages.get(index)!, match[2].split('.'), tag.value);
  }
  return Array.from(messages.entries())
    .sort(([a], [b]) => a - b)
    .map(([, message]) => normalizeMessage(message, 'user'))
    .filter((message): message is LlmMessage => message !== undefined);
}

function tryExtractMessages(content: string): LlmMessage[] {
  let parsed = extractMessagesFromJsonValue(content);
  if (parsed.length === 0 && content.startsWith('"')) {
    try {
      const inner = JSON.parse(content);
      if (typeof inner === 'string') {
        parsed = extractMessagesFromJsonValue(inner);
      }
    } catch {
      // ignore
    }
  }
  return parsed;
}

const GEN_AI_INPUT_EVENT_ROLES: Record<string, string> = {
  'gen_ai.system.message': 'system',
  'gen_ai.user.message': 'user',
  'gen_ai.assistant.message': 'assistant',
  'gen_ai.tool.message': 'tool',
};

function eventRecord(fields: KeyValuePair[]): Record<string, unknown> {
  const record: Record<string, unknown> = Object.create(null);
  for (const field of fields) {
    record[field.key] = field.value;
  }
  return record;
}

// gen_ai.system_instructions holds the system prompt separately from the chat history. It is an array
// of parts (the semconv shape), a single part, or plain text. It is only added when the history has no
// system message, so instrumentations that also repeat it in the history are not shown twice.
function withSystemInstructions(messages: LlmMessage[], instructions: unknown): LlmMessage[] {
  if (instructions === undefined || instructions === null || instructions === '') {
    return messages;
  }
  if (messages.some((message) => message.role === 'system')) {
    return messages;
  }
  const looksLikeJson = typeof instructions === 'string' && /^\s*[[{]/.test(instructions);
  const parsed = looksLikeJson ? parseJsonValue(instructions) : instructions;
  const partList = Array.isArray(parsed) ? parsed : isRecord(parsed) ? [parsed] : undefined;
  if (!partList) {
    return [{ role: 'system', content: stringifyValue(parsed) }, ...messages];
  }
  const parts = partList.map((part) => (typeof part === 'string' ? { type: 'text', text: part } : part));
  const message = normalizeMessage({ role: 'system', parts }, 'system');
  if (!message) {
    return messages;
  }
  const text = (message.parts ?? []).flatMap((part) => (part.type === 'text' ? [part.text] : []));
  return [{ ...message, content: text.join('\n') }, ...messages];
}

function inputMessagesFromEvent(eventName: string, record: Record<string, unknown>): LlmMessage[] {
  const defaultRole = GEN_AI_INPUT_EVENT_ROLES[eventName] ?? 'user';
  const legacyText = record['gen_ai.prompt'] ?? record['gen_ai.content'];
  const content = legacyText ?? record.content ?? undefined;
  // Older instrumentations put a whole JSON message list in the prompt of a user event.
  if (defaultRole === 'user' && typeof content === 'string') {
    const listed = tryExtractMessages(content);
    if (listed.length > 0) {
      return listed;
    }
  }
  const message = normalizeMessage(
    {
      role: record.role ?? defaultRole,
      content,
      tool_calls: record.tool_calls,
      tool_call_id: record.id ?? record.tool_call_id,
    },
    defaultRole
  );
  return message && (message.content || message.toolCalls || message.parts?.length) ? [message] : [];
}

function outputMessageFromChoice(record: Record<string, unknown>): LlmMessage | undefined {
  const message = parseJsonValue(record.message);
  const source: Record<string, unknown> = isRecord(message) ? { ...message } : { role: 'assistant', content: message };
  if (source.tool_calls === undefined || source.tool_calls === null) {
    source.tool_calls = record.tool_calls;
  }
  // Tool-calling responses carry content: null, which is no text rather than the text "null".
  if (source.content === null) {
    delete source.content;
  }
  return normalizeMessage(source, 'assistant');
}

interface EventMessages {
  input: LlmMessage[];
  output: LlmMessage[];
  tools: LlmToolDefinition[];
  finishReason?: string;
}

function extractMessagesFromEvents(logs: SpanLog[]): EventMessages {
  // Collect system messages separately so they can be prepended (system must come first per LLM API convention)
  const systemMessages: LlmMessage[] = [];
  const nonSystemInput: LlmMessage[] = [];
  // gen_ai.choice events are grouped by choice index. Streaming instrumentations send the text in chunks.
  const choices: Map<number, { text: string; messages: LlmMessage[] }> = new Map();
  const output: LlmMessage[] = [];
  let details: { input: LlmMessage[]; output: LlmMessage[]; instructions: unknown } | undefined;
  let tools: LlmToolDefinition[] = [];
  let finishReason: string | undefined;
  for (const log of logs) {
    const eventName = log.name || getAttr(log.fields, 'event') || '';
    const record = eventRecord(log.fields);
    if (eventName === 'gen_ai.client.inference.operation.details') {
      details = {
        input: extractMessagesFromValue(record['gen_ai.input.messages'] ?? record['gen_ai.input_messages']),
        output: extractMessagesFromValue(record['gen_ai.output.messages'] ?? record['gen_ai.output_messages']),
        instructions: record['gen_ai.system_instructions'],
      };
      tools = toolDefinitionsFromValue(record['gen_ai.tool.definitions']);
    } else if (eventName === 'gen_ai.content.prompt' || eventName in GEN_AI_INPUT_EVENT_ROLES) {
      const messages = inputMessagesFromEvent(eventName, record);
      if (eventName === 'gen_ai.system.message') {
        systemMessages.push(...messages);
      } else {
        nonSystemInput.push(...messages);
      }
    } else if (eventName === 'gen_ai.content.completion') {
      const content = getAttr(log.fields, 'gen_ai.completion') || getAttr(log.fields, 'gen_ai.content') || '';
      const rawContent = getRawStringAttr(log.fields, 'gen_ai.completion') || getRawStringAttr(log.fields, 'gen_ai.content') || '';
      const parsed = tryExtractMessages(rawContent);
      if (parsed.length > 0) {
        output.push(...parsed);
      } else if (content) {
        output.push({ role: 'assistant', content });
      }
    } else if (eventName === 'gen_ai.choice') {
      const indexValue = Number(record.index ?? record['gen_ai.choice.index'] ?? 0);
      const choiceIndex = Number.isNaN(indexValue) ? 0 : indexValue;
      const choice = choices.get(choiceIndex) ?? { text: '', messages: [] };
      choices.set(choiceIndex, choice);
      if (record.message !== undefined || record.tool_calls !== undefined) {
        const message = outputMessageFromChoice(record);
        if (message) {
          choice.messages.push(message);
        }
      } else {
        choice.text += getRawStringAttr(log.fields, 'gen_ai.completion') || getRawStringAttr(log.fields, 'gen_ai.content') || getRawStringAttr(log.fields, 'content') || '';
      }
      finishReason ??= typeof record.finish_reason === 'string' && record.finish_reason ? record.finish_reason : undefined;
    }
  }
  for (const [, choice] of Array.from(choices.entries()).sort(([a], [b]) => a - b)) {
    output.push(...choice.messages);
    const parsed = tryExtractMessages(choice.text);
    if (parsed.length > 0) {
      output.push(...parsed);
    } else if (choice.text) {
      output.push({ role: 'assistant', content: decodeUnicodeEscapes(choice.text) });
    }
  }
  if (details) {
    // The details event is the complete record of the call and supersedes the per-message events.
    const input = details.input.length > 0 ? details.input : [...systemMessages, ...nonSystemInput];
    return {
      input: withSystemInstructions(input, details.instructions),
      output: details.output.length > 0 ? details.output : output,
      tools,
      finishReason,
    };
  }
  // System messages always appear first in the conversation
  return { input: [...systemMessages, ...nonSystemInput], output, tools, finishReason };
}

function extractGcpVertexRequestMessages(jsonBlob: string): LlmMessage[] {
  try {
    const parsed = JSON.parse(jsonBlob);
    if (!isRecord(parsed)) {
      return [];
    }
    const messages: LlmMessage[] = [];
    // ADK nests the system instruction under config; the Vertex SDK request keeps it at the top level.
    const config = isRecord(parsed.config) ? parsed.config : {};
    const sysInstr = [config.systemInstruction, config.system_instruction, parsed.systemInstruction, parsed.system_instruction]
      .find((candidate) => candidate !== undefined && candidate !== null);
    if (typeof sysInstr === 'string' && sysInstr) {
      messages.push({ role: 'system', content: sysInstr });
    } else if (isRecord(sysInstr)) {
      // The instruction content often carries role "user"; it is still the system prompt.
      const message = normalizeMessage(sysInstr, 'system');
      if (message) {
        messages.push({ ...message, role: 'system' });
      }
    }
    if (Array.isArray(parsed.contents)) {
      for (const item of parsed.contents as unknown[]) {
        const message = normalizeMessage(item, 'user');
        if (message) {
          messages.push(message);
        }
      }
    }
    return messages;
  } catch {
    return [];
  }
}

function extractGcpVertexResponseMessages(jsonBlob: string): LlmMessage[] {
  try {
    const parsed = JSON.parse(jsonBlob);
    if (!isRecord(parsed)) {
      return [];
    }
    // ADK LlmResponse carries a single `content`; the Vertex SDK response lists `candidates`.
    if (!Array.isArray(parsed.candidates)) {
      const message = isRecord(parsed.content) ? normalizeMessage(parsed.content, 'model') : undefined;
      return message ? [message] : [];
    }
    return (parsed.candidates as unknown[]).map((c) => {
      if (!isRecord(c) || !isRecord(c.content)) {
        return { role: 'model', content: '' };
      }
      return normalizeMessage(c.content, 'model') ?? { role: 'model', content: '' };
    });
  } catch {
    return [];
  }
}

type AdkContentState = 'captured' | 'not-captured' | 'not-serialized';

// With ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS disabled ADK writes "{}" instead of the content. When it
// cannot serialize the content it writes <not serializable> or {"error": "serialization failed"}.
function getAdkContentState(raw: string | undefined): AdkContentState | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const text = raw.trim();
  if (text === '{}') {
    return 'not-captured';
  }
  if (text === '<not serializable>') {
    return 'not-serialized';
  }
  try {
    const parsed = JSON.parse(text);
    if (isRecord(parsed) && Object.keys(parsed).length === 1 && parsed.error === 'serialization failed') {
      return 'not-serialized';
    }
  } catch {
    // not JSON: the content was captured as plain text
  }
  return 'captured';
}

const ADK_NOT_CAPTURED_NOTICE =
  'Message content was not captured for this span (ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS is disabled).';

function getAdkContentNotices(tags: KeyValuePair[]): string[] {
  const isToolSpan = tags.some((t) => t.key === 'gcp.vertex.agent.tool_call_args' || t.key === 'gcp.vertex.agent.tool_response');
  const checks: Array<{ label: string; state: AdkContentState | undefined }> = isToolSpan
    ? [
        { label: 'tool arguments', state: getAdkContentState(getRawStringAttr(tags, 'gcp.vertex.agent.tool_call_args')) },
        { label: 'tool response', state: getAdkContentState(getRawStringAttr(tags, 'gcp.vertex.agent.tool_response')) },
      ]
    : [
        { label: 'request', state: getAdkContentState(getRawStringAttr(tags, 'gcp.vertex.agent.llm_request')) },
        { label: 'response', state: getAdkContentState(getRawStringAttr(tags, 'gcp.vertex.agent.llm_response')) },
      ];
  const notices: string[] = [];
  // A tool without arguments legitimately records "{}" arguments, so a tool span only counts as
  // not captured when its response was not captured either.
  const notCaptured = isToolSpan
    ? checks.every(({ state }) => state === 'not-captured')
    : checks.some(({ state }) => state === 'not-captured');
  if (notCaptured) {
    notices.push(ADK_NOT_CAPTURED_NOTICE);
  }
  for (const { label, state } of checks) {
    if (state === 'not-serialized') {
      notices.push(`ADK could not serialize the ${label} for this span.`);
    }
  }
  return notices;
}

// Tool arguments and results arrive as JSON text or, from OTLP exporters that send structured values,
// as arrays and objects. Valid JSON is parsed before its strings are decoded; anything else is decoded
// as plain text.
function toolPayloadText(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw !== 'string') {
    return JSON.stringify(decodeStrings(raw));
  }
  try {
    return JSON.stringify(decodeStrings(JSON.parse(raw)));
  } catch {
    return decodeUnicodeEscapes(raw);
  }
}

// A tool span records the call and its result as separate attributes instead of messages.
// They are shown as one assistant tool call followed by one tool result.
function buildToolCallMessages(
  name: string,
  id: string | undefined,
  args: string | undefined,
  response: string | undefined
): { input: LlmMessage[]; output: LlmMessage[] } {
  const toolCall: LlmToolCall = { name, arguments: args ?? '', ...(id ? { id } : {}) };
  return {
    input: args === undefined ? [] : [{ role: 'assistant', content: '', parts: [{ type: 'tool_call', toolCall }], toolCalls: [toolCall] }],
    output: response === undefined ? [] : [{
      role: 'tool',
      content: '',
      parts: [{ type: 'tool_result', result: response, toolCallId: id, name }],
      ...(id ? { toolCallId: id } : {}),
      name,
    }],
  };
}

function extractAdkToolMessages(tags: KeyValuePair[]): { input: LlmMessage[]; output: LlmMessage[] } | undefined {
  const args = toolPayloadText(getRawStringAttr(tags, 'gcp.vertex.agent.tool_call_args'));
  const response = toolPayloadText(getRawStringAttr(tags, 'gcp.vertex.agent.tool_response'));
  if (args === undefined && response === undefined) {
    return undefined;
  }
  if (getAdkContentNotices(tags).includes(ADK_NOT_CAPTURED_NOTICE)) {
    return undefined;
  }
  const name = getAttr(tags, 'gen_ai.tool.name') ?? 'unknown';
  const callId = getAttr(tags, 'gen_ai.tool.call.id');
  // ADK writes this placeholder when the response event carries no function response id.
  const id = callId && callId !== '<not specified>' ? callId : undefined;
  return buildToolCallMessages(name, id, args, response);
}

// OTel GenAI `execute_tool` spans: gen_ai.tool.call.arguments / gen_ai.tool.call.result, described by
// gen_ai.tool.name, gen_ai.tool.call.id, gen_ai.tool.description and gen_ai.tool.type.
function extractGenAiToolSpan(tags: KeyValuePair[]): { input: LlmMessage[]; output: LlmMessage[]; tools: LlmToolDefinition[] } | undefined {
  const args = toolPayloadText(getRawAttr(tags, 'gen_ai.tool.call.arguments'));
  const response = toolPayloadText(getRawAttr(tags, 'gen_ai.tool.call.result'));
  if (args === undefined && response === undefined) {
    return undefined;
  }
  const name = getAttr(tags, 'gen_ai.tool.name') ?? 'unknown';
  const description = getAttr(tags, 'gen_ai.tool.description');
  const type = getAttr(tags, 'gen_ai.tool.type');
  // The tool description is shown on the tool call card, which looks tools up by name.
  const tools: LlmToolDefinition[] = description || type
    ? [{ index: 0, type: type ?? 'function', name, ...(description ? { description } : {}), raw: { name, description, type }, isValid: name !== 'unknown' }]
    : [];
  return { ...buildToolCallMessages(name, getAttr(tags, 'gen_ai.tool.call.id'), args, response), tools };
}

function detectConvention(tags: KeyValuePair[], framework = detectFramework(tags)): LlmConvention | null {
  const oiKind = getAttr(tags, 'openinference.span.kind');
  if (oiKind) {
    return 'openinference';
  }
  // The AI SDK records OTel GenAI attributes next to its own, but its provider name can look like
  // Vertex ("google.vertex.chat"), so it is recognised before the Vertex checks.
  if (framework === 'vercel-ai') {
    return 'otel-genai';
  }
  const genAiSystem = getAttr(tags, 'gen_ai.system');
  if (genAiSystem && (genAiSystem.includes('vertex') || genAiSystem.includes('gcp'))) {
    return 'vertex';
  }
  // Only classify as openinference when gen_ai.system is absent — if it's present the span
  // follows OTel GenAI convention even if it also carries llm.request.type (Traceloop compat).
  if (!genAiSystem && tags.some((t) => t.key === 'llm.model_name' || t.key === 'llm.request.type' || t.key.startsWith('llm.input_messages.') || t.key.startsWith('llm.output_messages.'))) {
    return 'openinference';
  }
  if (tags.some((t) => t.key.startsWith('llm.prompts.') || t.key.startsWith('llm.completions.'))) {
    return 'vertex';
  }
  if (tags.some((t) => t.key.startsWith('gcp.vertex.agent.'))) {
    return 'vertex';
  }
  if (genAiSystem || tags.some((t) => t.key.startsWith('gen_ai.'))) {
    return 'otel-genai';
  }
  const hasCompletionType = tags.some(
    (t) => (t.key.endsWith('.operation.type') || t.key === 'operation.type') && String(t.value).toLowerCase().includes('completion')
  );
  const hasMessageAttr = tags.some((t) => typeof t.value === 'string' && looksLikeMessages(t.value));
  if (hasCompletionType || hasMessageAttr) {
    return 'generic';
  }
  return null;
}

function extractOpenInference(tags: KeyValuePair[], logs: SpanLog[]): Omit<LlmSpanData, 'isLlm'> {
  const model = getAttr(tags, 'gen_ai.response.model') || getAttr(tags, 'llm.model_name') || getAttr(tags, 'gen_ai.request.model') || 'unknown';
  const spanKind = getAttr(tags, 'openinference.span.kind');
  let inputMessages = extractIndexedMessages(tags, 'llm.input_messages.');
  if (inputMessages.length === 0) {
    inputMessages = extractIndexedMessages(tags, 'llm.prompts.');
  }
  if (inputMessages.length === 0) {
    const genAiInput = getRawAttr(tags, 'gen_ai.input.messages') ?? getRawAttr(tags, 'gen_ai.input_messages');
    if (genAiInput !== undefined && genAiInput !== null) {
      inputMessages = extractMessagesFromValue(genAiInput);
    }
  }
  if (inputMessages.length === 0) {
    const gcpReq = getRawStringAttr(tags, 'gcp.vertex.agent.llm_request');
    if (gcpReq) {
      inputMessages = extractGcpVertexRequestMessages(gcpReq);
    }
  }
  let outputMessages = extractIndexedMessages(tags, 'llm.output_messages.');
  if (outputMessages.length === 0) {
    outputMessages = extractIndexedMessages(tags, 'llm.completions.');
  }
  if (outputMessages.length === 0) {
    const genAiOutput = getRawAttr(tags, 'gen_ai.output.messages') ?? getRawAttr(tags, 'gen_ai.output_messages');
    if (genAiOutput !== undefined && genAiOutput !== null) {
      outputMessages = extractMessagesFromValue(genAiOutput);
    }
  }
  if (outputMessages.length === 0) {
    const gcpResp = getRawStringAttr(tags, 'gcp.vertex.agent.llm_response');
    if (gcpResp) {
      outputMessages = extractGcpVertexResponseMessages(gcpResp);
    }
  }
  if (inputMessages.length === 0) {
    const inputValue = getAttr(tags, 'input.value');
    if (inputValue) {
      inputMessages = extractMessagesFromJsonValue(getRawStringAttr(tags, 'input.value') ?? inputValue);
      if (inputMessages.length === 0 && inputValue.trim()) {
        inputMessages = [{ role: 'user', content: inputValue }];
      }
    }
  }
  if (outputMessages.length === 0) {
    const outputValue = getAttr(tags, 'output.value');
    if (outputValue) {
      outputMessages = extractMessagesFromJsonValue(getRawStringAttr(tags, 'output.value') ?? outputValue);
      if (outputMessages.length === 0 && outputValue.trim()) {
        outputMessages = [{ role: 'assistant', content: outputValue }];
      }
    }
  }
  if (inputMessages.length === 0 && outputMessages.length === 0 && logs.length > 0) {
    const fromEvents = extractMessagesFromEvents(logs);
    inputMessages = fromEvents.input;
    outputMessages = fromEvents.output;
  }
  inputMessages = withSystemInstructions(inputMessages, getRawAttr(tags, 'gen_ai.system_instructions'));
  let invocationParams: LlmInvocationParams = {};
  const invParamsStr = getRawStringAttr(tags, 'llm.invocation_parameters');
  if (invParamsStr) {
    let parsed = false;
    try {
      invocationParams = JSON.parse(invParamsStr);
      parsed = true;
    } catch {
      // try Python repr format: single quotes, True/False/None
    }
    if (!parsed) {
      try {
        const normalized = invParamsStr
          .replace(/'/g, '"')
          .replace(/\bTrue\b/g, 'true')
          .replace(/\bFalse\b/g, 'false')
          .replace(/\bNone\b/g, 'null');
        invocationParams = JSON.parse(normalized);
        parsed = true;
      } catch {
        // fall through to individual gen_ai.request.* attributes
      }
    }
    if (!parsed) {
      const temp = getNumAttr(tags, 'gen_ai.request.temperature');
      const maxTok = getNumAttr(tags, 'gen_ai.request.max_tokens');
      const topP = getNumAttr(tags, 'gen_ai.request.top_p');
      if (temp !== undefined) invocationParams.temperature = temp;
      if (maxTok !== undefined) invocationParams.maxTokens = maxTok;
      if (topP !== undefined) invocationParams.topP = topP;
    }
  }
  const finishReason = getAttr(tags, 'llm.output_messages.0.message.finish_reason')
    ?? getAttr(tags, 'output.finish_reason')
    ?? getAttr(tags, 'llm.stop_reason');
  const precomputedCostUsd = getReportedCost(tags);
  return {
    convention: 'openinference',
    spanKind,
    model,
    system: getAttr(tags, 'gen_ai.system') || getAttr(tags, 'llm.system'),
    inputMessages,
    outputMessages,
    tools: extractOpenInferenceToolDefinitions(tags),
    tokenUsage: {
      input: getNumAttr(tags, 'llm.token_count.prompt') ?? getNumAttr(tags, 'gen_ai.usage.input_tokens') ?? getNumAttr(tags, 'llm.usage.prompt_tokens'),
      output: getNumAttr(tags, 'llm.token_count.completion') ?? getNumAttr(tags, 'gen_ai.usage.output_tokens') ?? getNumAttr(tags, 'llm.usage.completion_tokens'),
      total: getNumAttr(tags, 'llm.token_count.total') ?? getNumAttr(tags, 'gen_ai.usage.total_tokens') ?? getNumAttr(tags, 'llm.usage.total_tokens'),
      ...extractTokenDetails(tags),
    },
    invocationParams,
    finishReason,
    ...(precomputedCostUsd !== undefined ? { precomputedCostUsd } : {}),
  };
}

// Request parameters that have a named field in the parameter list above.
const NAMED_REQUEST_PARAMS = new Set(['model', 'temperature', 'max_tokens', 'top_p', 'top_k', 'frequency_penalty', 'presence_penalty']);

// Every other gen_ai.request.* attribute (seed, stop_sequences, choice.count, ...) is shown under its own name.
function extractOtherRequestParams(tags: KeyValuePair[]): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const tag of tags) {
    const name = tag.key.startsWith('gen_ai.request.') ? tag.key.slice('gen_ai.request.'.length) : '';
    if (name && !NAMED_REQUEST_PARAMS.has(name) && tag.value !== undefined && tag.value !== null && tag.value !== '') {
      params[name] = tag.value;
    }
  }
  return params;
}

function extractOtelGenAi(tags: KeyValuePair[], logs: SpanLog[]): Omit<LlmSpanData, 'isLlm'> {
  // Prefer gen_ai.response.model when present — after streaming/routing the served model may differ
  // from the requested model (e.g. provider-side aliasing or fallback routing).
  const model = getAttr(tags, 'gen_ai.response.model') || getAttr(tags, 'gen_ai.request.model') || getAttr(tags, 'llm.request.model') || 'unknown';
  const fromEvents = extractMessagesFromEvents(logs);
  let inputMessages = fromEvents.input;
  const outputMessages = fromEvents.output;
  if (inputMessages.length === 0) {
    const prompt = getAttr(tags, 'gen_ai.prompt');
    if (prompt) {
      const parsed = extractMessagesFromJsonValue(getRawStringAttr(tags, 'gen_ai.prompt') ?? prompt);
      inputMessages.push(...(parsed.length > 0 ? parsed : [{ role: 'user', content: prompt }]));
    }
  }
  if (inputMessages.length === 0) {
    const genAiInput = getRawAttr(tags, 'gen_ai.input.messages') ?? getRawAttr(tags, 'gen_ai.input_messages');
    if (genAiInput !== undefined && genAiInput !== null) {
      inputMessages.push(...extractMessagesFromValue(genAiInput));
    }
  }
  if (inputMessages.length === 0) {
    // Traceloop flat-indexed format: gen_ai.prompt.{i}.role / gen_ai.prompt.{i}.content
    inputMessages.push(...extractIndexedMessages(tags, 'gen_ai.prompt.'));
  }
  if (outputMessages.length === 0) {
    const completion = getAttr(tags, 'gen_ai.completion');
    if (completion) {
      const parsed = extractMessagesFromJsonValue(getRawStringAttr(tags, 'gen_ai.completion') ?? completion);
      outputMessages.push(...(parsed.length > 0 ? parsed : [{ role: 'assistant', content: completion }]));
    }
  }
  if (outputMessages.length === 0) {
    const genAiOutput = getRawAttr(tags, 'gen_ai.output.messages') ?? getRawAttr(tags, 'gen_ai.output_messages');
    if (genAiOutput !== undefined && genAiOutput !== null) {
      outputMessages.push(...extractMessagesFromValue(genAiOutput));
    }
  }
  if (outputMessages.length === 0) {
    // Traceloop flat-indexed format: gen_ai.completion.{i}.role / gen_ai.completion.{i}.content
    outputMessages.push(...extractIndexedMessages(tags, 'gen_ai.completion.'));
  }
  const toolSpan = inputMessages.length === 0 && outputMessages.length === 0 ? extractGenAiToolSpan(tags) : undefined;
  if (toolSpan) {
    inputMessages.push(...toolSpan.input);
    outputMessages.push(...toolSpan.output);
  }
  inputMessages = withSystemInstructions(inputMessages, getRawAttr(tags, 'gen_ai.system_instructions'));
  const finishReasonsRaw = getRawStringAttr(tags, 'gen_ai.response.finish_reasons');
  let finishReasonFromArray: string | undefined;
  if (finishReasonsRaw) {
    try {
      const arr = JSON.parse(finishReasonsRaw);
      if (Array.isArray(arr) && arr.length > 0) finishReasonFromArray = String(arr[0]);
    } catch { /* not an array */ }
  }
  const finishReason = getAttr(tags, 'gen_ai.response.finish_reasons.0')
    ?? finishReasonFromArray
    ?? getAttr(tags, 'gen_ai.finish_reason')
    ?? fromEvents.finishReason;
  const precomputedCostUsd = getReportedCost(tags);
  const attributeTools = extractOtelToolDefinitions(tags);
  const tools = attributeTools.length > 0 ? attributeTools : fromEvents.tools.length > 0 ? fromEvents.tools : toolSpan?.tools ?? [];
  return {
    convention: 'otel-genai',
    model,
    system: getAttr(tags, 'gen_ai.system'),
    inputMessages,
    outputMessages,
    tools,
    tokenUsage: {
      input: getNumAttr(tags, 'gen_ai.usage.input_tokens') ?? getNumAttr(tags, 'gen_ai.usage.prompt_tokens'),
      output: getNumAttr(tags, 'gen_ai.usage.output_tokens') ?? getNumAttr(tags, 'gen_ai.usage.completion_tokens'),
      total: getNumAttr(tags, 'gen_ai.usage.total_tokens'),
      ...extractTokenDetails(tags),
    },
    invocationParams: {
      temperature: getNumAttr(tags, 'gen_ai.request.temperature'),
      maxTokens: getNumAttr(tags, 'gen_ai.request.max_tokens'),
      topP: getNumAttr(tags, 'gen_ai.request.top_p'),
      // gen_ai.request.top_k is used by Anthropic, Gemini and other providers.
      // It must be included explicitly here because the LlmInvocationParams index type
      // only passes through named fields; unknown keys from tags are not auto-collected.
      ...(getNumAttr(tags, 'gen_ai.request.top_k') !== undefined
        ? { topK: getNumAttr(tags, 'gen_ai.request.top_k') }
        : {}),
      ...(getNumAttr(tags, 'gen_ai.request.frequency_penalty') !== undefined
        ? { frequencyPenalty: getNumAttr(tags, 'gen_ai.request.frequency_penalty') }
        : {}),
      ...(getNumAttr(tags, 'gen_ai.request.presence_penalty') !== undefined
        ? { presencePenalty: getNumAttr(tags, 'gen_ai.request.presence_penalty') }
        : {}),
      ...(getAttr(tags, 'gen_ai.operation.name') !== undefined
        ? { operationName: getAttr(tags, 'gen_ai.operation.name') }
        : {}),
      ...extractOtherRequestParams(tags),
    },
    finishReason,
    ...(precomputedCostUsd !== undefined ? { precomputedCostUsd } : {}),
  };
}

function extractGeneric(tags: KeyValuePair[], logs: SpanLog[], operationName?: string): Omit<LlmSpanData, 'isLlm'> {
  let inputMessages: LlmMessage[] = [];
  let outputMessages: LlmMessage[] = [];
  const inputKeys = ['workflow.input', 'input.value', 'input', 'request.body', 'llm.input', 'prompt'];
  const outputKeys = ['workflow.output', 'output.value', 'output', 'response.body', 'llm.output', 'completion'];
  for (const key of inputKeys) {
    const val = getRawStringAttr(tags, key);
    if (val && looksLikeMessages(val)) {
      inputMessages = extractMessagesFromJsonValue(val);
      if (inputMessages.length > 0) {
        break;
      }
    }
  }
  for (const key of outputKeys) {
    const val = getRawStringAttr(tags, key);
    if (val && looksLikeMessages(val)) {
      outputMessages = extractMessagesFromJsonValue(val);
      if (outputMessages.length > 0) {
        break;
      }
    }
  }
  const model =
    getAttr(tags, 'gen_ai.request.model') || getAttr(tags, 'llm.model_name') || getAttr(tags, 'model') || operationName || 'unknown';
  if (inputMessages.length === 0 && outputMessages.length === 0 && logs.length > 0) {
    const fromEvents = extractMessagesFromEvents(logs);
    inputMessages = fromEvents.input;
    outputMessages = fromEvents.output;
  }
  const finishReason = getAttr(tags, 'finish_reason') ?? getAttr(tags, 'stop_reason');
  const precomputedCostUsd = getReportedCost(tags);
  return {
    convention: 'generic',
    model,
    inputMessages,
    outputMessages,
    tools: [],
    tokenUsage: {
      input: getNumAttr(tags, 'gen_ai.usage.input_tokens') ?? getNumAttr(tags, 'llm.token_count.prompt') ?? getNumAttr(tags, 'prompt_tokens'),
      output: getNumAttr(tags, 'gen_ai.usage.output_tokens') ?? getNumAttr(tags, 'llm.token_count.completion') ?? getNumAttr(tags, 'completion_tokens'),
      total: getNumAttr(tags, 'gen_ai.usage.total_tokens') ?? getNumAttr(tags, 'llm.token_count.total') ?? getNumAttr(tags, 'total_tokens'),
      ...extractTokenDetails(tags),
    },
    invocationParams: {
      temperature: getNumAttr(tags, 'gen_ai.request.temperature') ?? getNumAttr(tags, 'temperature'),
      maxTokens: getNumAttr(tags, 'gen_ai.request.max_tokens') ?? getNumAttr(tags, 'max_tokens'),
      topP: getNumAttr(tags, 'gen_ai.request.top_p') ?? getNumAttr(tags, 'top_p'),
    },
    finishReason,
    ...(precomputedCostUsd !== undefined ? { precomputedCostUsd } : {}),
  };
}

// Fills what the standard extraction found nothing for with what the framework's own attributes say.
function applyFrameworkSpan(data: Omit<LlmSpanData, 'isLlm'>, span: FrameworkSpan | undefined): Omit<LlmSpanData, 'isLlm'> {
  if (!span) {
    return data;
  }
  const hasMessages = data.inputMessages.length > 0 || data.outputMessages.length > 0;
  const toolMessages = span.tool && !hasMessages
    ? buildToolCallMessages(span.tool.name ?? 'unknown', span.tool.id, toolPayloadText(span.tool.args), toolPayloadText(span.tool.result))
    : undefined;
  const invocationParams: LlmInvocationParams = { ...data.invocationParams };
  for (const [key, value] of Object.entries(span.params ?? {})) {
    if (invocationParams[key] === undefined) {
      invocationParams[key] = value;
    }
  }
  return {
    ...data,
    model: data.model === 'unknown' && span.model ? span.model : data.model,
    system: data.system ?? span.system,
    inputMessages: data.inputMessages.length > 0 ? data.inputMessages : span.input !== undefined ? extractMessagesFromValue(span.input) : toolMessages?.input ?? [],
    outputMessages: data.outputMessages.length > 0 ? data.outputMessages : span.output !== undefined ? extractMessagesFromValue(span.output) : toolMessages?.output ?? [],
    tools: data.tools.length > 0 ? data.tools : toolDefinitionsFromValue(span.tools),
    tokenUsage: {
      ...data.tokenUsage,
      input: data.tokenUsage.input ?? span.usage?.input,
      output: data.tokenUsage.output ?? span.usage?.output,
      total: data.tokenUsage.total ?? span.usage?.total,
    },
    invocationParams,
    finishReason: data.finishReason ?? span.finishReason,
  };
}

// Agent spans of the AI SDK and other agent frameworks carry the usage and cost of every model call
// below them (invoke_agent, agent_step).
function isAggregateOperation(tags: KeyValuePair[]): boolean {
  const operation = getAttr(tags, 'gen_ai.operation.name')?.toLowerCase();
  return operation === 'invoke_agent' || operation === 'agent_step';
}

// A span that repeats what its children already report is not a model call of its own:
// counting it would double the trace totals.
function isModelCall(tags: KeyValuePair[], framework: LlmFramework | undefined): boolean {
  const kind = getSpanKind(tags);
  return kind !== 'TOOL' && !isAggregateOperation(tags) && !(framework === 'vercel-ai' && kind === 'CHAIN');
}

export function extractLlmSpanData(tags: KeyValuePair[], logs: SpanLog[], operationName?: string, scope?: SpanScope): LlmSpanData {
  const framework = detectFramework(tags, scope);
  const convention = detectConvention(tags, framework);
  if (!convention) {
    return { isLlm: false, convention: 'unknown', model: '', inputMessages: [], outputMessages: [], tools: [], tokenUsage: {}, invocationParams: {}, finishReason: undefined };
  }
  let data: Omit<LlmSpanData, 'isLlm'>;
  switch (convention) {
    case 'openinference':
      data = extractOpenInference(tags, logs);
      break;
    case 'otel-genai':
      data = extractOtelGenAi(tags, logs);
      break;
    case 'vertex': {
      const toolMessages = extractAdkToolMessages(tags);
      data = {
        ...extractOpenInference(tags, logs),
        convention: 'vertex',
        tools: extractVertexToolDefinitions(getRawStringAttr(tags, 'gcp.vertex.agent.llm_request')),
      };
      if (toolMessages && data.inputMessages.length === 0 && data.outputMessages.length === 0) {
        data = { ...data, inputMessages: toolMessages.input, outputMessages: toolMessages.output };
      }
      const contentNotices = getAdkContentNotices(tags);
      if (contentNotices.length > 0) {
        data = { ...data, contentNotices };
      }
      break;
    }
    default:
      data = extractGeneric(tags, logs, operationName);
  }
  if (framework === 'vercel-ai') {
    data = applyFrameworkSpan(data, extractVercelAi(tags));
  }
  // For OpenInference, only treat the span as LLM if it's an LLM call or a GUARDRAIL
  // (guardrails invoke an LLM internally and carry the same llm.* attributes).
  // CHAIN, TOOL, RETRIEVER etc. are structural spans, not the model call itself.
  const isLlm = convention === 'openinference'
    ? data.spanKind?.toUpperCase() === 'LLM' || data.spanKind?.toUpperCase() === 'GUARDRAIL'
    : isModelCall(tags, framework);
  return { isLlm, ...data, ...(framework ? { framework } : {}) };
}

export function getLlmDisplayAttributeKeys(
  tags: KeyValuePair[],
  data: LlmSpanData
): Set<string> {
  if (data.convention === 'unknown') {
    return new Set();
  }

  const keys = new Set<string>();
  const addExact = (...candidates: string[]) => {
    for (const candidate of candidates) {
      if (tags.some((tag) => tag.key === candidate)) {
        keys.add(candidate);
      }
    }
  };
  const addPrefixes = (...prefixes: string[]) => {
    for (const tag of tags) {
      if (prefixes.some((prefix) => tag.key.startsWith(prefix))) {
        keys.add(tag.key);
      }
    }
  };

  if (data.model && data.model !== 'unknown') {
    if (data.convention === 'openinference' || data.convention === 'vertex') {
      addExact('gen_ai.response.model', 'llm.model_name', 'gen_ai.request.model');
    } else if (data.convention === 'otel-genai') {
      addExact('gen_ai.response.model', 'gen_ai.request.model', 'llm.request.model');
    } else {
      addExact('gen_ai.request.model', 'llm.model_name', 'model');
    }
  }
  if (data.system) {
    if (data.convention === 'openinference' || data.convention === 'vertex') {
      addExact('gen_ai.system', 'llm.system');
    } else {
      addExact('gen_ai.system');
    }
  }
  if (getSpanKind(tags)) {
    if (data.convention === 'openinference' || data.convention === 'vertex') {
      addExact('openinference.span.kind', 'llm.request.type');
      if (data.convention === 'vertex') {
        addExact('gen_ai.operation.name');
      }
    } else if (data.convention === 'otel-genai') {
      addExact('gen_ai.operation.name');
    }
  }

  if (data.convention === 'openinference' || data.convention === 'vertex') {
    if (data.inputMessages.length > 0) {
      addExact('gen_ai.input.messages', 'gen_ai.input_messages', 'gen_ai.system_instructions', 'gcp.vertex.agent.llm_request', 'input.value');
      addPrefixes('llm.input_messages.', 'llm.prompts.');
    }
    if (data.outputMessages.length > 0) {
      addExact('gen_ai.output.messages', 'gen_ai.output_messages', 'gcp.vertex.agent.llm_response', 'output.value');
      addPrefixes('llm.output_messages.', 'llm.completions.');
    }
    if (data.tools.length > 0) {
      addExact('gcp.vertex.agent.llm_request');
      addPrefixes('llm.tools.');
    }
    if (data.convention === 'vertex' && (data.inputMessages.length > 0 || data.outputMessages.length > 0)) {
      addExact('gcp.vertex.agent.tool_call_args', 'gcp.vertex.agent.tool_response', 'gen_ai.tool.name', 'gen_ai.tool.call.id');
    }
  } else if (data.convention === 'otel-genai') {
    if (data.inputMessages.length > 0) {
      addExact('gen_ai.prompt', 'gen_ai.input.messages', 'gen_ai.input_messages', 'gen_ai.system_instructions');
      addPrefixes('gen_ai.prompt.');
    }
    if (data.outputMessages.length > 0) {
      addExact('gen_ai.completion', 'gen_ai.output.messages', 'gen_ai.output_messages');
      addPrefixes('gen_ai.completion.');
    }
    if (data.tools.length > 0) {
      addExact('gen_ai.tool.definitions');
    }
    if (tags.some((t) => t.key === 'gen_ai.tool.call.arguments' || t.key === 'gen_ai.tool.call.result')) {
      addExact(
        'gen_ai.tool.call.arguments',
        'gen_ai.tool.call.result',
        'gen_ai.tool.name',
        'gen_ai.tool.call.id',
        'gen_ai.tool.description',
        'gen_ai.tool.type'
      );
    }
  } else {
    if (data.inputMessages.length > 0) {
      addExact('workflow.input', 'input.value', 'input', 'request.body', 'llm.input', 'prompt');
    }
    if (data.outputMessages.length > 0) {
      addExact('workflow.output', 'output.value', 'output', 'response.body', 'llm.output', 'completion');
    }
  }

  for (const detail of Object.keys(USAGE_DETAIL_SUFFIXES) as Array<keyof typeof USAGE_DETAIL_SUFFIXES>) {
    if (data.tokenUsage[detail] !== undefined) {
      addExact(...usageDetailKeys(detail));
    }
  }
  if (data.tokenUsage.input !== undefined) {
    addExact('llm.token_count.prompt', 'gen_ai.usage.input_tokens', 'gen_ai.usage.prompt_tokens', 'llm.usage.prompt_tokens', 'prompt_tokens');
  }
  if (data.tokenUsage.output !== undefined) {
    addExact('llm.token_count.completion', 'gen_ai.usage.output_tokens', 'gen_ai.usage.completion_tokens', 'llm.usage.completion_tokens', 'completion_tokens');
  }
  if (data.tokenUsage.total !== undefined) {
    addExact('llm.token_count.total', 'gen_ai.usage.total_tokens', 'llm.usage.total_tokens', 'total_tokens');
  }

  if (Object.values(data.invocationParams).some((value) => value !== undefined && value !== null)) {
    addExact(
      'llm.invocation_parameters',
      'gen_ai.request.temperature',
      'gen_ai.request.max_tokens',
      'gen_ai.request.top_p',
      'gen_ai.request.top_k',
      'gen_ai.request.frequency_penalty',
      'gen_ai.request.presence_penalty',
      'gen_ai.operation.name',
      'temperature',
      'max_tokens',
      'top_p'
    );
  }
  if (data.finishReason) {
    addExact(
      'llm.output_messages.0.message.finish_reason',
      'output.finish_reason',
      'llm.stop_reason',
      'gen_ai.response.finish_reasons',
      'gen_ai.response.finish_reasons.0',
      'gen_ai.finish_reason',
      'finish_reason',
      'stop_reason'
    );
  }
  if (data.precomputedCostUsd !== undefined) {
    addExact(...REPORTED_COST_KEYS);
  }
  if (data.convention === 'otel-genai' && Object.keys(data.invocationParams).length > 0) {
    addPrefixes('gen_ai.request.');
  }

  const openInferenceKind = data.spanKind?.toUpperCase();
  if (openInferenceKind === 'TOOL') {
    addExact('tool.name', 'tool.description', 'tool.parameters', 'input.value', 'output.value');
  } else if (openInferenceKind === 'RERANKER') {
    addExact('reranker.query', 'reranker.model_name', 'input.value', 'output.value');
    addPrefixes('reranker.results.');
  } else if (openInferenceKind === 'RETRIEVER') {
    addExact('input.value');
    addPrefixes('retrieval.documents.');
  } else if (['CHAIN', 'AGENT', 'EMBEDDING', 'UNKNOWN'].includes(openInferenceKind ?? '')) {
    addExact('input.value', 'output.value');
  }

  if (data.framework === 'vercel-ai') {
    if (data.inputMessages.length > 0) {
      addExact('ai.prompt.messages', 'ai.prompt', 'ai.toolCall.args', 'ai.toolCall.input', 'ai.values', 'ai.value');
    }
    if (data.outputMessages.length > 0) {
      addExact(
        'ai.response.text', 'ai.response.toolCalls', 'ai.response.object',
        'ai.result.text', 'ai.result.toolCalls', 'ai.result.object',
        'ai.toolCall.result', 'ai.toolCall.output'
      );
    }
    if (data.tools.length > 0) {
      addExact('ai.prompt.tools');
    }
    if (data.model && data.model !== 'unknown') {
      addExact('ai.model.id');
    }
    if (data.system) {
      addExact('ai.model.provider');
    }
    if (data.finishReason) {
      addExact('ai.response.finishReason');
    }
    if (data.tokenUsage.input !== undefined || data.tokenUsage.output !== undefined || data.tokenUsage.total !== undefined) {
      addPrefixes('ai.usage.');
    }
    if (Object.values(data.invocationParams).some((value) => value !== undefined && value !== null)) {
      addExact('ai.prompt.toolChoice');
      addPrefixes('ai.settings.');
    }
    if (getVercelAiKind(tags) === 'TOOL') {
      addExact('ai.toolCall.name', 'ai.toolCall.id');
    }
  }

  return keys;
}

export function isAiSpan(tags: KeyValuePair[]): boolean {
  return detectConvention(tags) !== null;
}

export function isOpenInferenceSpan(tags: KeyValuePair[]): boolean {
  return tags.some((t) => t.key === 'openinference.span.kind');
}

export function isEmbeddingSpan(tags: KeyValuePair[]): boolean {
  if (getVercelAiKind(tags) === 'EMBEDDING') {
    return true;
  }
  const requestType = tags.find((t) => t.key === 'llm.request.type');
  if (requestType) {
    return String(requestType.value).toLowerCase().includes('embedding');
  }
  const opName = tags.find((t) => t.key === 'gen_ai.operation.name');
  if (opName) {
    const v = String(opName.value).toLowerCase();
    if (v === 'embeddings' || v === 'create_embeddings' || v === 'embed') {
      return true;
    }
  }
  return false;
}

export function isLlmSpan(tags: KeyValuePair[]): boolean {
  // Embedding spans are not LLM chat/completion spans
  if (isEmbeddingSpan(tags)) {
    return false;
  }
  const oiKind = tags.find((t) => t.key === 'openinference.span.kind');
  if (oiKind) {
    const kind = String(oiKind.value).toUpperCase();
    return kind === 'LLM' || kind === 'GUARDRAIL';
  }
  if (getSpanKind(tags) === 'TOOL' || isAggregateOperation(tags)) {
    return false;
  }
  const vercelAiKind = getVercelAiKind(tags);
  if (vercelAiKind) {
    return vercelAiKind === 'LLM';
  }
  if (tags.some(
    (t) =>
      t.key === 'gen_ai.system' ||
      t.key === 'gen_ai.request.model' ||
      t.key === 'llm.model_name' ||
      t.key === 'llm.request.type' ||
      t.key.startsWith('llm.input_messages.') ||
      t.key.startsWith('llm.prompts.') ||
      t.key.startsWith('gen_ai.usage.')
  )) {
    return true;
  }
  // ADK tool and agent spans carry placeholder gcp.vertex.agent.llm_request/llm_response attributes
  // although they do not call a model.
  if (tags.some((t) => t.key.startsWith('gcp.vertex.agent.'))) {
    const kind = getSpanKind(tags);
    return kind !== 'TOOL' && kind !== 'AGENT';
  }
  // Generic convention: operation.type containing "completion"
  return tags.some(
    (t) => (t.key.endsWith('.operation.type') || t.key === 'operation.type') && String(t.value).toLowerCase().includes('completion')
  );
}

export function isGuardrailSpan(tags: KeyValuePair[]): boolean {
  const oiKind = tags.find((t) => t.key === 'openinference.span.kind');
  if (oiKind && String(oiKind.value).toUpperCase() === 'GUARDRAIL') {
    return true;
  }
  const opName = tags.find((t) => t.key === 'gen_ai.operation.name');
  if (opName) {
    const v = String(opName.value).toLowerCase();
    if (v === 'guardrail' || v === 'check_guardrail') { return true; }
  }
  return false;
}

// Maps gen_ai.operation.name values (OTel GenAI spec) to normalized span kind labels.
const OTEL_OPERATION_TO_KIND: Record<string, string> = {
  // LLM
  chat: 'LLM',
  text_completion: 'LLM',
  completions: 'LLM',
  generate: 'LLM',
  generate_content: 'LLM',
  call_llm: 'LLM',
  // AGENT
  invoke_agent: 'AGENT',
  execute_agent: 'AGENT',
  create_agent: 'AGENT',
  // TOOL
  execute_tool: 'TOOL',
  tool_call: 'TOOL',
  // EMBEDDING
  embeddings: 'EMBEDDING',
  create_embeddings: 'EMBEDDING',
  embed: 'EMBEDDING',
  // RERANKER
  rerank: 'RERANKER',
  // GUARDRAIL
  guardrail: 'GUARDRAIL',
  check_guardrail: 'GUARDRAIL',
};

function hasGenAiToolIdentity(tags: KeyValuePair[]): boolean {
  return tags.some((t) => (t.key === 'gen_ai.tool.name' || t.key === 'gen_ai.tool.call.id') && t.value !== '' && t.value !== undefined && t.value !== null);
}

/**
 * Returns the display span kind across all supported conventions:
 *   - OpenInference: openinference.span.kind (AGENT, LLM, CHAIN, TOOL, RETRIEVER, EMBEDDING, RERANKER)
 *   - OTel GenAI:    gen_ai.operation.name mapped to normalized labels
 *   - GCP Vertex:    derives LLM from gen_ai.operation.name or gen_ai.system presence
 * Returns undefined for non-AI spans.
 */
export function getSpanKind(tags: KeyValuePair[]): string | undefined {
  // OpenInference — explicit kind attribute, trust it directly
  const oiKind = getAttr(tags, 'openinference.span.kind');
  if (oiKind) {
    return oiKind.toUpperCase();
  }

  // OTel GenAI / Vertex — derive kind from gen_ai.operation.name
  const opName = getAttr(tags, 'gen_ai.operation.name');
  if (opName) {
    return OTEL_OPERATION_TO_KIND[opName.toLowerCase()] ?? opName.toUpperCase();
  }

  const vercelAiKind = getVercelAiKind(tags);
  if (vercelAiKind) {
    return vercelAiKind;
  }

  // Frameworks such as Pydantic AI set no operation name on tool spans.
  if (hasGenAiToolIdentity(tags)) {
    return 'TOOL';
  }

  // Fallback: any span with gen_ai.system, gen_ai.request.model, llm.model_name, or
  // llm.request.type is an LLM inference span with no explicit kind — show "LLM"
  const isInferenceSpan = tags.some(
    (t) =>
      t.key === 'gen_ai.system' ||
      t.key === 'gen_ai.request.model' ||
      t.key === 'llm.model_name' ||
      t.key === 'llm.request.type'
  );
  if (isInferenceSpan) {
    return 'LLM';
  }

  return undefined;
}

/** The span name to show: the AI SDK names spans after the telemetry function id and the tool they call. */
export function getSpanDisplayName(operationName: string, tags: KeyValuePair[]): string {
  return getVercelAiDisplayName(tags) ?? operationName;
}

// OTel GenAI names agent spans "invoke_agent <name>" and "create_agent <name>".
const AGENT_SPAN_NAME = /^(?:invoke|create)_agent\s+(\S.*?)\s*$/;

function getNonBlankAttr(tags: KeyValuePair[], key: string): string | undefined {
  const value = getAttr(tags, key)?.trim();
  return value ? value : undefined;
}

/**
 * Returns the agent name across all supported conventions, first match wins:
 *   - gen_ai.agent.name  (OTel GenAI spec + modern OpenInference >= 1.4)
 *   - agent.name
 *   - the <name> of a span name such as "invoke_agent <name>"
 * Returns undefined when none of them is present.
 */
export function getAgentName(tags: KeyValuePair[], spanName?: string): string | undefined {
  return getNonBlankAttr(tags, 'gen_ai.agent.name')
    ?? getNonBlankAttr(tags, 'agent.name')
    ?? spanName?.match(AGENT_SPAN_NAME)?.[1];
}

export function getAgentDescription(tags: KeyValuePair[]): string | undefined {
  return getNonBlankAttr(tags, 'gen_ai.agent.description');
}

export function getSpanKindColor(kind: string | undefined): string {
  switch (kind?.toUpperCase()) {
    case 'LLM': return '#7B61FF';
    case 'CHAIN': return '#3274D9';
    case 'AGENT': return '#E0851A';
    case 'TOOL': return '#5794F2';
    case 'RETRIEVER': return '#73BF69';
    case 'EMBEDDING': return '#B877D9';
    case 'RERANKER': return '#FF9830';
    case 'GUARDRAIL': return '#F59E0B';
    case 'UNKNOWN': return '#6B7280';
    default: return '#8E8E8E';
  }
}

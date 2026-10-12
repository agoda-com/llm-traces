// Ported from public/app/features/explore/TraceView/components/TraceTimelineViewer/SpanDetail/llmUtils.ts
// Extracts LLM span data from OpenInference / OTel GenAI / Vertex AI / generic conventions.

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

export interface LlmTokenUsage {
  input?: number;
  output?: number;
  total?: number;
}

export interface LlmInvocationParams {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  [key: string]: unknown;
}

export type LlmConvention = 'openinference' | 'otel-genai' | 'vertex' | 'generic' | 'unknown';

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
  return decodeUnicodeEscapes(String(value));
}

function getRawAttr(tags: KeyValuePair[], key: string): unknown {
  return tags.find((tag) => tag.key === key)?.value;
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

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') {
    return decodeUnicodeEscapes(value);
  }
  if (value !== null && typeof value === 'object') {
    try {
      return JSON.stringify(value);
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
  const parameters = definition?.parameters ?? definition?.parameters_json_schema ?? definition?.parametersJsonSchema;
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

function extractOtelToolDefinitions(tags: KeyValuePair[]): LlmToolDefinition[] {
  const raw = getRawAttr(tags, 'gen_ai.tool.definitions');
  if (raw === undefined || raw === null) {
    return [];
  }
  const parsed = parseJsonValue(raw);
  const definitions = Array.isArray(parsed) ? parsed : [parsed];
  return definitions.map(normalizeToolDefinition);
}

function extractVertexToolDefinitions(jsonBlob: string | undefined): LlmToolDefinition[] {
  if (!jsonBlob) {
    return [];
  }
  const parsed = parseJsonValue(jsonBlob);
  if (!isRecord(parsed) || !Array.isArray(parsed.tools)) {
    return [];
  }
  const definitions: LlmToolDefinition[] = [];
  for (const tool of parsed.tools) {
    if (!isRecord(tool)) {
      continue;
    }
    const declarations = tool.functionDeclarations ?? tool.function_declarations;
    if (!Array.isArray(declarations)) {
      continue;
    }
    for (const declaration of declarations) {
      definitions.push(normalizeToolDefinition(declaration, definitions.length));
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
      result: functionResponse.response ?? functionResponse.result ?? '',
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
      result: part.response ?? part.result ?? part.output ?? part.content ?? '',
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

function extractMessagesFromEvents(logs: SpanLog[]): { input: LlmMessage[]; output: LlmMessage[] } {
  // Collect system messages separately so they can be prepended (system must come first per LLM API convention)
  const systemMessages: LlmMessage[] = [];
  const nonSystemInput: LlmMessage[] = [];
  // For gen_ai.choice streaming: accumulate by choice index
  const choiceAccumulator: Map<number, { content: string }> = new Map();
  const output: LlmMessage[] = [];
  for (const log of logs) {
    const eventName = log.name || getAttr(log.fields, 'event') || '';
    if (eventName === 'gen_ai.content.prompt' || eventName === 'gen_ai.user.message') {
      const content = getAttr(log.fields, 'gen_ai.prompt') || getAttr(log.fields, 'gen_ai.content') || '';
      const role = getAttr(log.fields, 'role') || 'user';
      const parsed = tryExtractMessages(content);
      if (parsed.length > 0) {
        nonSystemInput.push(...parsed);
      } else if (content) {
        nonSystemInput.push({ role, content });
      }
    } else if (eventName === 'gen_ai.system.message') {
      const content = getAttr(log.fields, 'gen_ai.content') || getAttr(log.fields, 'gen_ai.prompt') || '';
      if (content) {
        systemMessages.push({ role: 'system', content });
      }
    } else if (eventName === 'gen_ai.content.completion' || eventName === 'gen_ai.assistant.message') {
      const content = getAttr(log.fields, 'gen_ai.completion') || getAttr(log.fields, 'gen_ai.content') || '';
      const parsed = tryExtractMessages(content);
      if (parsed.length > 0) {
        output.push(...parsed);
      } else if (content) {
        output.push({ role: 'assistant', content });
      }
    } else if (eventName === 'gen_ai.choice') {
      const content = getAttr(log.fields, 'gen_ai.completion') || getAttr(log.fields, 'gen_ai.content') || '';
      const choiceIndexRaw = getAttr(log.fields, 'gen_ai.choice.index');
      const choiceIndex = choiceIndexRaw !== undefined ? parseInt(choiceIndexRaw, 10) : 0;
      const existing = choiceAccumulator.get(choiceIndex);
      if (existing) {
        existing.content += content;
      } else {
        choiceAccumulator.set(choiceIndex, { content });
      }
    }
  }
  // Flush accumulated choice chunks as output messages
  if (choiceAccumulator.size > 0) {
    for (const [, chunk] of Array.from(choiceAccumulator.entries()).sort(([a], [b]) => a - b)) {
      const parsed = tryExtractMessages(chunk.content);
      if (parsed.length > 0) {
        output.push(...parsed);
      } else if (chunk.content) {
        output.push({ role: 'assistant', content: chunk.content });
      }
    }
  }
  // System messages always appear first in the conversation
  return { input: [...systemMessages, ...nonSystemInput], output };
}

function extractGcpVertexRequestMessages(jsonBlob: string): LlmMessage[] {
  try {
    const parsed = JSON.parse(jsonBlob);
    if (!isRecord(parsed)) {
      return [];
    }
    const messages: LlmMessage[] = [];
    const sysInstr = parsed.system_instruction;
    if (typeof sysInstr === 'string' && sysInstr) {
      messages.push({ role: 'system', content: sysInstr });
    } else if (isRecord(sysInstr)) {
      const message = normalizeMessage(sysInstr, 'system');
      if (message) {
        messages.push(message);
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
    if (!isRecord(parsed) || !Array.isArray(parsed.candidates)) {
      return [];
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

function detectConvention(tags: KeyValuePair[]): LlmConvention | null {
  const oiKind = getAttr(tags, 'openinference.span.kind');
  if (oiKind) {
    return 'openinference';
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
    const gcpReq = getAttr(tags, 'gcp.vertex.agent.llm_request');
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
    const gcpResp = getAttr(tags, 'gcp.vertex.agent.llm_response');
    if (gcpResp) {
      outputMessages = extractGcpVertexResponseMessages(gcpResp);
    }
  }
  if (inputMessages.length === 0) {
    const inputValue = getAttr(tags, 'input.value');
    if (inputValue) {
      inputMessages = extractMessagesFromJsonValue(inputValue);
      if (inputMessages.length === 0 && inputValue.trim()) {
        inputMessages = [{ role: 'user', content: inputValue }];
      }
    }
  }
  if (outputMessages.length === 0) {
    const outputValue = getAttr(tags, 'output.value');
    if (outputValue) {
      outputMessages = extractMessagesFromJsonValue(outputValue);
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
  let invocationParams: LlmInvocationParams = {};
  const invParamsStr = getAttr(tags, 'llm.invocation_parameters');
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
  const precomputedCostUsd = getNumAttr(tags, 'gen_ai.cost.total_cost');
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
    },
    invocationParams,
    finishReason,
    ...(precomputedCostUsd !== undefined ? { precomputedCostUsd } : {}),
  };
}

function extractOtelGenAi(tags: KeyValuePair[], logs: SpanLog[]): Omit<LlmSpanData, 'isLlm'> {
  // Prefer gen_ai.response.model when present — after streaming/routing the served model may differ
  // from the requested model (e.g. provider-side aliasing or fallback routing).
  const model = getAttr(tags, 'gen_ai.response.model') || getAttr(tags, 'gen_ai.request.model') || getAttr(tags, 'llm.request.model') || 'unknown';
  const { input: inputMessages, output: outputMessages } = extractMessagesFromEvents(logs);
  if (inputMessages.length === 0) {
    const prompt = getAttr(tags, 'gen_ai.prompt');
    if (prompt) {
      const parsed = extractMessagesFromJsonValue(prompt);
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
      const parsed = extractMessagesFromJsonValue(completion);
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
  const finishReasonsRaw = getAttr(tags, 'gen_ai.response.finish_reasons');
  let finishReasonFromArray: string | undefined;
  if (finishReasonsRaw) {
    try {
      const arr = JSON.parse(finishReasonsRaw);
      if (Array.isArray(arr) && arr.length > 0) finishReasonFromArray = String(arr[0]);
    } catch { /* not an array */ }
  }
  const finishReason = getAttr(tags, 'gen_ai.response.finish_reasons.0')
    ?? finishReasonFromArray
    ?? getAttr(tags, 'gen_ai.finish_reason');
  const precomputedCostUsd = getNumAttr(tags, 'gen_ai.cost.total_cost');
  return {
    convention: 'otel-genai',
    model,
    system: getAttr(tags, 'gen_ai.system'),
    inputMessages,
    outputMessages,
    tools: extractOtelToolDefinitions(tags),
    tokenUsage: {
      input: getNumAttr(tags, 'gen_ai.usage.input_tokens') ?? getNumAttr(tags, 'gen_ai.usage.prompt_tokens'),
      output: getNumAttr(tags, 'gen_ai.usage.output_tokens') ?? getNumAttr(tags, 'gen_ai.usage.completion_tokens'),
      total: getNumAttr(tags, 'gen_ai.usage.total_tokens'),
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
    const val = getAttr(tags, key);
    if (val && looksLikeMessages(val)) {
      inputMessages = extractMessagesFromJsonValue(val);
      if (inputMessages.length > 0) {
        break;
      }
    }
  }
  for (const key of outputKeys) {
    const val = getAttr(tags, key);
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
  const precomputedCostUsd = getNumAttr(tags, 'gen_ai.cost.total_cost');
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

export function extractLlmSpanData(tags: KeyValuePair[], logs: SpanLog[], operationName?: string): LlmSpanData {
  const convention = detectConvention(tags);
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
    case 'vertex':
      data = {
        ...extractOpenInference(tags, logs),
        convention: 'vertex',
        tools: extractVertexToolDefinitions(getAttr(tags, 'gcp.vertex.agent.llm_request')),
      };
      break;
    default:
      data = extractGeneric(tags, logs, operationName);
  }
  // For OpenInference, only treat the span as LLM if it's an LLM call or a GUARDRAIL
  // (guardrails invoke an LLM internally and carry the same llm.* attributes).
  // CHAIN, TOOL, RETRIEVER etc. are structural spans, not the model call itself.
  const isLlm = convention === 'openinference'
    ? data.spanKind?.toUpperCase() === 'LLM' || data.spanKind?.toUpperCase() === 'GUARDRAIL'
    : true;
  return { isLlm, ...data };
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
    } else if (data.convention === 'otel-genai') {
      addExact('gen_ai.operation.name');
    }
  }

  if (data.convention === 'openinference' || data.convention === 'vertex') {
    if (data.inputMessages.length > 0) {
      addExact('gen_ai.input.messages', 'gen_ai.input_messages', 'gcp.vertex.agent.llm_request', 'input.value');
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
  } else if (data.convention === 'otel-genai') {
    if (data.inputMessages.length > 0) {
      addExact('gen_ai.prompt', 'gen_ai.input.messages', 'gen_ai.input_messages');
      addPrefixes('gen_ai.prompt.');
    }
    if (data.outputMessages.length > 0) {
      addExact('gen_ai.completion', 'gen_ai.output.messages', 'gen_ai.output_messages');
      addPrefixes('gen_ai.completion.');
    }
    if (data.tools.length > 0) {
      addExact('gen_ai.tool.definitions');
    }
  } else {
    if (data.inputMessages.length > 0) {
      addExact('workflow.input', 'input.value', 'input', 'request.body', 'llm.input', 'prompt');
    }
    if (data.outputMessages.length > 0) {
      addExact('workflow.output', 'output.value', 'output', 'response.body', 'llm.output', 'completion');
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
    addExact('gen_ai.cost.total_cost');
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

  return keys;
}

export function isAiSpan(tags: KeyValuePair[]): boolean {
  return detectConvention(tags) !== null;
}

export function isOpenInferenceSpan(tags: KeyValuePair[]): boolean {
  return tags.some((t) => t.key === 'openinference.span.kind');
}

export function isEmbeddingSpan(tags: KeyValuePair[]): boolean {
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
  if (tags.some(
    (t) =>
      t.key === 'gen_ai.system' ||
      t.key === 'gen_ai.request.model' ||
      t.key === 'llm.model_name' ||
      t.key === 'llm.request.type' ||
      t.key.startsWith('llm.input_messages.') ||
      t.key.startsWith('llm.prompts.') ||
      t.key.startsWith('gen_ai.usage.') ||
      t.key.startsWith('gcp.vertex.agent.')
  )) {
    return true;
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

/**
 * Returns the agent name across all supported conventions:
 *   - gen_ai.agent.name  (OTel GenAI spec + modern OpenInference ≥ 1.4)
 * Returns undefined when no agent name attribute is found.
 */
export function getAgentName(tags: KeyValuePair[]): string | undefined {
  return getAttr(tags, 'gen_ai.agent.name');
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

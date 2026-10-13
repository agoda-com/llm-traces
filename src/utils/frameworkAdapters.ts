// Readers for frameworks that record prompts, responses and tool calls under their own attribute names.
// They work on span attributes only and return plain values in shapes the message normaliser in
// llmUtils.ts already reads (OpenAI-style messages and `tool_call` / `tool_result` parts), so this module
// does not depend on llmUtils.ts at runtime.

import type { KeyValuePair } from './llmUtils.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function attr(tags: KeyValuePair[], key: string): unknown {
  return tags.find((tag) => tag.key === key)?.value;
}

function firstAttr(tags: KeyValuePair[], keys: string[]): unknown {
  for (const key of keys) {
    const value = attr(tags, key);
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return undefined;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function textOf(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function numberOf(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
}

export interface FrameworkUsage {
  input?: number;
  output?: number;
  total?: number;
}

export interface FrameworkSpan {
  kind?: string;
  model?: string;
  system?: string;
  input?: unknown;
  output?: unknown;
  tools?: unknown;
  usage?: FrameworkUsage;
  finishReason?: string;
  params?: Record<string, unknown>;
  tool?: { name?: string; id?: string; args?: unknown; result?: unknown };
}

// ---------------------------------------------------------------------------
// Vercel AI SDK (instrumentation scope "ai")
// ---------------------------------------------------------------------------

const VERCEL_LLM_OPERATIONS = new Set([
  'ai.generateText.doGenerate',
  'ai.streamText.doStream',
  'ai.generateObject.doGenerate',
  'ai.streamObject.doStream',
]);
const VERCEL_EMBEDDING_OPERATIONS = new Set(['ai.embed.doEmbed', 'ai.embedMany.doEmbed']);

/**
 * The AI SDK operation of a span, e.g. `ai.generateText.doGenerate`. It comes from `ai.operationId`, or from
 * `operation.name`, which may carry the telemetry function id after a space.
 */
export function getVercelAiOperation(tags: KeyValuePair[]): string | undefined {
  const operationId = attr(tags, 'ai.operationId');
  if (typeof operationId === 'string' && operationId.startsWith('ai.')) {
    return operationId;
  }
  const operationName = attr(tags, 'operation.name');
  if (typeof operationName === 'string' && operationName.startsWith('ai.')) {
    return operationName.split(' ')[0];
  }
  return undefined;
}

/**
 * LLM for model calls, EMBEDDING for embedding calls, TOOL for tool executions. The wrapper spans around
 * them (ai.generateText, ai.streamText, ai.embed, ...) are CHAIN: they repeat the usage of their model calls.
 */
export function getVercelAiKind(tags: KeyValuePair[]): string | undefined {
  const operation = getVercelAiOperation(tags);
  if (!operation) {
    return undefined;
  }
  if (VERCEL_LLM_OPERATIONS.has(operation)) {
    return 'LLM';
  }
  if (VERCEL_EMBEDDING_OPERATIONS.has(operation)) {
    return 'EMBEDDING';
  }
  return operation === 'ai.toolCall' ? 'TOOL' : 'CHAIN';
}

/** `<functionId>:<operation>` for AI SDK spans with a telemetry function id, the tool name for tool calls. */
export function getVercelAiDisplayName(tags: KeyValuePair[]): string | undefined {
  const toolName = attr(tags, 'ai.toolCall.name');
  if (typeof toolName === 'string' && toolName) {
    return toolName;
  }
  const operation = getVercelAiOperation(tags);
  if (!operation) {
    return undefined;
  }
  const functionId = attr(tags, 'ai.telemetry.functionId');
  return typeof functionId === 'string' && functionId ? `${functionId}:${operation}` : operation;
}

function toolResultValue(part: Record<string, unknown>): unknown {
  const output = part.output ?? part.result;
  // AI SDK 5 wraps results as { type: 'json' | 'text' | 'error-text' | ..., value }.
  return isRecord(output) && typeof output.type === 'string' && 'value' in output ? output.value : output;
}

function convertAiSdkPart(part: unknown): unknown {
  if (typeof part === 'string') {
    return { type: 'text', text: part };
  }
  if (!isRecord(part)) {
    return part;
  }
  switch (part.type) {
    case 'tool-call':
      return { type: 'tool_call', id: part.toolCallId, name: part.toolName, arguments: part.input ?? part.args };
    case 'tool-result':
      return { type: 'tool_result', id: part.toolCallId, name: part.toolName, result: toolResultValue(part) };
    default:
      return part;
  }
}

function convertAiSdkMessage(message: unknown): unknown {
  if (!isRecord(message) || !Array.isArray(message.content)) {
    return message;
  }
  const { content, ...rest } = message;
  return { ...rest, parts: content.map(convertAiSdkPart) };
}

function convertAiSdkMessages(value: unknown): unknown[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed.map(convertAiSdkMessage) : [];
}

// `ai.prompt` on the wrapper spans is { system?, prompt?, messages? }; prompt is text or a message list.
function convertAiSdkPrompt(value: unknown): unknown[] | undefined {
  const parsed = parseJson(value);
  if (typeof parsed === 'string') {
    return parsed ? [{ role: 'user', content: parsed }] : undefined;
  }
  if (Array.isArray(parsed)) {
    return convertAiSdkMessages(parsed);
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const messages: unknown[] = [];
  if (typeof parsed.system === 'string' && parsed.system) {
    messages.push({ role: 'system', content: parsed.system });
  }
  if (typeof parsed.prompt === 'string' && parsed.prompt) {
    messages.push({ role: 'user', content: parsed.prompt });
  } else if (Array.isArray(parsed.prompt)) {
    messages.push(...convertAiSdkMessages(parsed.prompt));
  }
  if (Array.isArray(parsed.messages)) {
    messages.push(...convertAiSdkMessages(parsed.messages));
  }
  return messages.length > 0 ? messages : undefined;
}

function convertAiSdkResponse(tags: KeyValuePair[]): unknown[] | undefined {
  const text = textOf(firstAttr(tags, ['ai.response.text', 'ai.result.text']));
  const toolCalls = parseJson(firstAttr(tags, ['ai.response.toolCalls', 'ai.result.toolCalls']));
  const object = textOf(firstAttr(tags, ['ai.response.object', 'ai.result.object']));
  const parts: unknown[] = [];
  if (text) {
    parts.push({ type: 'text', text });
  }
  if (Array.isArray(toolCalls)) {
    for (const call of toolCalls) {
      if (isRecord(call)) {
        parts.push({ type: 'tool_call', id: call.toolCallId, name: call.toolName, arguments: call.input ?? call.args });
      }
    }
  }
  if (parts.length > 0) {
    return [{ role: 'assistant', parts }];
  }
  return object ? [{ role: 'assistant', content: object }] : undefined;
}

function vercelAiSettings(tags: KeyValuePair[]): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const tag of tags) {
    if (tag.key.startsWith('ai.settings.') && tag.value !== undefined && tag.value !== null && tag.value !== '') {
      params[tag.key.slice('ai.settings.'.length)] = tag.value;
    }
  }
  const toolChoice = parseJson(attr(tags, 'ai.prompt.toolChoice'));
  if (toolChoice !== undefined && toolChoice !== null && toolChoice !== '') {
    params.toolChoice = isRecord(toolChoice) && typeof toolChoice.type === 'string' ? toolChoice.type : toolChoice;
  }
  return params;
}

/**
 * Reads the AI SDK attributes of a span: ai.prompt.messages, ai.prompt, ai.response.text / toolCalls / object
 * (ai.result.* before AI SDK 4), ai.toolCall.*, ai.model.*, ai.usage.*, ai.prompt.tools and ai.settings.*.
 * Returns undefined for spans that are not AI SDK spans.
 */
export function extractVercelAi(tags: KeyValuePair[]): FrameworkSpan | undefined {
  const kind = getVercelAiKind(tags);
  if (!kind) {
    return undefined;
  }
  const result: FrameworkSpan = { kind };
  const model = attr(tags, 'ai.model.id');
  if (typeof model === 'string' && model) {
    result.model = model;
  }
  const provider = attr(tags, 'ai.model.provider');
  if (typeof provider === 'string' && provider) {
    result.system = provider;
  }
  const finishReason = attr(tags, 'ai.response.finishReason');
  if (typeof finishReason === 'string' && finishReason) {
    result.finishReason = finishReason;
  }
  result.params = vercelAiSettings(tags);
  const input = numberOf(firstAttr(tags, ['ai.usage.inputTokens', 'ai.usage.promptTokens']));
  const output = numberOf(firstAttr(tags, ['ai.usage.outputTokens', 'ai.usage.completionTokens']));
  // AI SDK 4 reports no total.
  const total = numberOf(firstAttr(tags, ['ai.usage.totalTokens', 'ai.usage.tokens']))
    ?? (input !== undefined && output !== undefined ? input + output : undefined);
  result.usage = { input, output, total };
  if (kind === 'TOOL') {
    result.tool = {
      name: textOf(attr(tags, 'ai.toolCall.name')),
      id: textOf(attr(tags, 'ai.toolCall.id')),
      args: firstAttr(tags, ['ai.toolCall.args', 'ai.toolCall.input']),
      result: firstAttr(tags, ['ai.toolCall.result', 'ai.toolCall.output']),
    };
    return result;
  }
  if (kind === 'EMBEDDING') {
    const values = parseJson(firstAttr(tags, ['ai.values', 'ai.value']));
    const list = Array.isArray(values) ? values : values === undefined ? [] : [values];
    result.input = list.map((value) => ({ role: 'user', content: typeof value === 'string' ? textOf(parseJson(value)) ?? value : textOf(value) }));
    // The usage of an embedding call is a single token count for the input.
    result.usage = { input: result.usage.total ?? result.usage.input, total: result.usage.total ?? result.usage.input };
    return result;
  }
  const promptMessages = attr(tags, 'ai.prompt.messages');
  result.input = promptMessages !== undefined ? convertAiSdkMessages(promptMessages) : convertAiSdkPrompt(attr(tags, 'ai.prompt'));
  result.output = convertAiSdkResponse(tags);
  result.tools = attr(tags, 'ai.prompt.tools');
  return result;
}

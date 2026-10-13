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
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
  audioOutput?: number;
}

export interface FrameworkSpan {
  kind?: string;
  model?: string;
  system?: string;
  input?: unknown;
  output?: unknown;
  // Events in the Logfire format: one record per GenAI event, named by `event.name`.
  events?: Array<Record<string, unknown>>;
  // The application set input and output explicitly, so they win over what the standard attributes hold.
  explicitIo?: boolean;
  tools?: unknown;
  usage?: FrameworkUsage;
  cost?: number;
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

// ---------------------------------------------------------------------------
// Pydantic AI (Logfire attributes, instrumentation scope "pydantic-ai")
// ---------------------------------------------------------------------------

const PYDANTIC_AI_KEYS = ['pydantic_ai.all_messages', 'all_messages_events', 'model_request_parameters', 'tool_arguments', 'tool_response'];

// Older Pydantic AI versions put the GenAI events of a model call into one `events` attribute.
function hasLogfireGenAiEvents(tags: KeyValuePair[]): boolean {
  const events = recordList(attr(tags, 'events'));
  return events !== undefined && events.some((event) => typeof event['event.name'] === 'string' && event['event.name'].startsWith('gen_ai.'));
}

export function hasPydanticAiSignature(tags: KeyValuePair[]): boolean {
  return tags.some((tag) => PYDANTIC_AI_KEYS.includes(tag.key)) || hasLogfireGenAiEvents(tags);
}

/** TOOL for tool runs and AGENT for agent runs, which repeat the usage of their model calls. */
export function getPydanticAiKind(tags: KeyValuePair[]): string | undefined {
  if (attr(tags, 'tool_arguments') !== undefined || attr(tags, 'tool_response') !== undefined) {
    return 'TOOL';
  }
  if (attr(tags, 'pydantic_ai.all_messages') !== undefined || attr(tags, 'all_messages_events') !== undefined) {
    return 'AGENT';
  }
  return undefined;
}

function recordList(value: unknown): Array<Record<string, unknown>> | undefined {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed.filter(isRecord) : undefined;
}

/**
 * Reads Pydantic AI spans: pydantic_ai.all_messages (or the older all_messages_events and prompt) and final_result
 * on agent runs, tool_arguments and tool_response on tool runs, the older Logfire `events` attribute on model calls
 * and model_request_parameters.function_tools as tool definitions.
 */
export function extractPydanticAi(tags: KeyValuePair[]): FrameworkSpan | undefined {
  if (!hasPydanticAiSignature(tags)) {
    return undefined;
  }
  const kind = getPydanticAiKind(tags);
  const result: FrameworkSpan = { ...(kind ? { kind } : {}) };
  const modelName = attr(tags, 'model_name');
  if (typeof modelName === 'string' && modelName) {
    result.model = modelName;
  }
  const cost = numberOf(attr(tags, 'operation.cost'));
  if (cost !== undefined) {
    result.cost = cost;
  }
  const requestParameters = parseJson(attr(tags, 'model_request_parameters'));
  if (isRecord(requestParameters) && Array.isArray(requestParameters.function_tools) && requestParameters.function_tools.length > 0) {
    result.tools = requestParameters.function_tools;
  }
  if (kind === 'TOOL') {
    result.tool = {
      name: textOf(attr(tags, 'gen_ai.tool.name')),
      id: textOf(attr(tags, 'gen_ai.tool.call.id')),
      args: attr(tags, 'tool_arguments'),
      result: attr(tags, 'tool_response'),
    };
    return result;
  }
  if (kind === 'AGENT') {
    const allMessages = attr(tags, 'pydantic_ai.all_messages');
    const messageEvents = recordList(attr(tags, 'all_messages_events'));
    const prompt = textOf(attr(tags, 'prompt'));
    if (allMessages !== undefined) {
      result.input = parseJson(allMessages);
    } else if (messageEvents && messageEvents.length > 0) {
      result.events = messageEvents;
    } else if (prompt) {
      result.input = [{ role: 'user', content: prompt }];
    }
    const finalResult = textOf(attr(tags, 'final_result'));
    if (finalResult) {
      result.output = [{ role: 'assistant', content: finalResult }];
    }
    return result;
  }
  const events = recordList(attr(tags, 'events'));
  if (events) {
    result.events = events;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Langfuse SDK attributes (langfuse.observation.*, langfuse.trace.*)
// ---------------------------------------------------------------------------

export function hasLangfuseSignature(tags: KeyValuePair[]): boolean {
  return tags.some((tag) => tag.key.startsWith('langfuse.'));
}

const LANGFUSE_KINDS: Record<string, string> = {
  generation: 'LLM',
  embedding: 'EMBEDDING',
  agent: 'AGENT',
  tool: 'TOOL',
  chain: 'CHAIN',
  retriever: 'RETRIEVER',
  guardrail: 'GUARDRAIL',
  evaluator: 'EVALUATOR',
  event: 'EVENT',
};

const LANGFUSE_GENERATION_KEYS = [
  'langfuse.observation.model.name',
  'langfuse.observation.model.parameters',
  'langfuse.observation.usage_details',
  'langfuse.observation.cost_details',
  'langfuse.observation.prompt.name',
  'langfuse.observation.prompt.version',
];

/** The observation type as a span kind. A plain span has none. */
export function getLangfuseKind(tags: KeyValuePair[]): string | undefined {
  const type = textOf(attr(tags, 'langfuse.observation.type'))?.toLowerCase();
  const hasGenerationAttributes = tags.some((tag) => LANGFUSE_GENERATION_KEYS.includes(tag.key));
  // SDK 3.3 and older record generations as plain spans that carry generation attributes.
  if ((type === undefined || type === 'span') && hasGenerationAttributes) {
    return 'LLM';
  }
  return type ? LANGFUSE_KINDS[type] : undefined;
}

function jsonRecord(value: unknown): Record<string, unknown> | undefined {
  const parsed = parseJson(value);
  return isRecord(parsed) ? parsed : undefined;
}

function langfuseUsage(details: Record<string, unknown>): FrameworkUsage {
  const count = (...keys: string[]) => keys.map((key) => numberOf(details[key])).find((value) => value !== undefined);
  const cacheRead = count('input_cached_tokens', 'input_cache_read', 'input_cache_read_tokens', 'cache_read_input_tokens');
  const cacheWrite = count('input_cache_creation', 'input_cache_write', 'input_cache_write_tokens', 'cache_creation_input_tokens');
  const cacheWriteLong = (count('input_cache_creation_5m') ?? 0) + (count('input_cache_creation_1h') ?? 0);
  const reasoning = count('output_reasoning_tokens', 'output_reasoning');
  const audioOutput = count('output_audio_tokens');
  const input = count('input', 'promptTokens', 'prompt_tokens', 'input_tokens');
  const output = count('output', 'completionTokens', 'completion_tokens', 'output_tokens');
  // Langfuse usage types are separate units: "input" excludes the cached and written tokens and "output"
  // excludes reasoning and audio. Elsewhere in this plugin input and output include them.
  const totalCacheWrite = (cacheWrite ?? 0) + cacheWriteLong;
  return {
    input: input === undefined ? undefined : input + (cacheRead ?? 0) + totalCacheWrite,
    output: output === undefined ? undefined : output + (reasoning ?? 0) + (audioOutput ?? 0),
    total: count('total', 'totalTokens', 'total_tokens'),
    cacheRead,
    cacheWrite: cacheWrite === undefined && cacheWriteLong === 0 ? undefined : totalCacheWrite,
    reasoning,
    audioOutput,
  };
}

function langfuseCost(details: Record<string, unknown>): number | undefined {
  const total = numberOf(details.total);
  if (total !== undefined) {
    return total;
  }
  const parts = Object.values(details).map(numberOf).filter((value): value is number => value !== undefined);
  return parts.length > 0 ? parts.reduce((sum, value) => sum + value, 0) : undefined;
}

/**
 * Reads the attributes the Langfuse SDKs write: langfuse.observation.input / output (the trace-level input and
 * output as a fallback), model.name, model.parameters, usage_details, cost_details and prompt.name / version.
 */
export function extractLangfuse(tags: KeyValuePair[]): FrameworkSpan | undefined {
  if (!hasLangfuseSignature(tags)) {
    return undefined;
  }
  const kind = getLangfuseKind(tags);
  const result: FrameworkSpan = { ...(kind ? { kind } : {}), explicitIo: true };
  result.input = firstAttr(tags, ['langfuse.observation.input', 'langfuse.trace.input']);
  result.output = firstAttr(tags, ['langfuse.observation.output', 'langfuse.trace.output']);
  const model = textOf(attr(tags, 'langfuse.observation.model.name'));
  if (model) {
    result.model = model;
  }
  const params: Record<string, unknown> = { ...jsonRecord(attr(tags, 'langfuse.observation.model.parameters')) };
  const promptName = textOf(attr(tags, 'langfuse.observation.prompt.name'));
  const promptVersion = attr(tags, 'langfuse.observation.prompt.version');
  if (promptName) {
    params.promptName = promptName;
  }
  if (promptName && promptVersion !== undefined && promptVersion !== '') {
    params.promptVersion = promptVersion;
  }
  result.params = params;
  const usage = jsonRecord(attr(tags, 'langfuse.observation.usage_details'));
  if (usage) {
    result.usage = langfuseUsage(usage);
  }
  const cost = jsonRecord(attr(tags, 'langfuse.observation.cost_details'));
  if (cost) {
    result.cost = langfuseCost(cost);
  }
  return result;
}

/** Facts about the trace and the observation that the detail header shows next to the span. The prompt is a parameter. */
export function getSpanMetadata(tags: KeyValuePair[]): Array<{ label: string; value: string }> {
  const text = (...keys: string[]) => textOf(firstAttr(tags, keys));
  const tagList = firstAttr(tags, ['langfuse.trace.tags', 'langfuse.tags', 'ai.telemetry.metadata.tags', 'tag.tags']);
  const parsedTags = parseJson(tagList);
  const level = text('langfuse.observation.level');
  const entries: Array<[string, string | undefined]> = [
    ['Trace', text('langfuse.trace.name')],
    ['User', text('langfuse.user.id', 'user.id', 'ai.telemetry.metadata.userId')],
    ['Session', text('langfuse.session.id', 'session.id', 'gen_ai.conversation.id', 'ai.telemetry.metadata.sessionId')],
    ['Tags', Array.isArray(parsedTags) ? parsedTags.map(String).join(', ') : textOf(tagList)],
    ['Environment', text('langfuse.environment')],
    ['Release', text('langfuse.release')],
    ['Version', text('langfuse.version')],
    ['Level', level && level.toUpperCase() !== 'DEFAULT' ? level : undefined],
    ['Status', text('langfuse.observation.status_message')],
  ];
  return entries.flatMap(([label, value]) => (value ? [{ label, value }] : []));
}

// ---------------------------------------------------------------------------
// Traceloop / OpenLLMetry entity spans
// ---------------------------------------------------------------------------

// Only spans that carry traceloop.span.kind or entity input / output are Traceloop entity spans. OpenLLMetry
// model spans also carry traceloop.workflow.name and traceloop.entity.name, but they are GenAI spans.
export function hasTraceloopSignature(tags: KeyValuePair[]): boolean {
  return tags.some((tag) => ['traceloop.span.kind', 'traceloop.entity.input', 'traceloop.entity.output'].includes(tag.key));
}

const TRACELOOP_KINDS: Record<string, string> = { workflow: 'CHAIN', task: 'CHAIN', agent: 'AGENT', tool: 'TOOL' };

export function getTraceloopKind(tags: KeyValuePair[]): string | undefined {
  const kind = textOf(attr(tags, 'traceloop.span.kind'))?.toLowerCase();
  return kind ? TRACELOOP_KINDS[kind] : undefined;
}

/** Reads traceloop.entity.input / output, and turns tool entities into a tool call. */
export function extractTraceloop(tags: KeyValuePair[]): FrameworkSpan | undefined {
  if (!hasTraceloopSignature(tags)) {
    return undefined;
  }
  const kind = getTraceloopKind(tags);
  const input = attr(tags, 'traceloop.entity.input');
  const output = attr(tags, 'traceloop.entity.output');
  if (kind === 'TOOL') {
    return { kind, tool: { name: textOf(attr(tags, 'traceloop.entity.name')), args: input, result: output } };
  }
  return { ...(kind ? { kind } : {}), input, output };
}

// ---------------------------------------------------------------------------
// MLflow tracing
// ---------------------------------------------------------------------------

export function hasMlflowSignature(tags: KeyValuePair[]): boolean {
  return tags.some((tag) => ['mlflow.spanType', 'mlflow.spanInputs', 'mlflow.spanOutputs'].includes(tag.key));
}

const MLFLOW_KINDS: Record<string, string | undefined> = {
  LLM: 'LLM',
  CHAT_MODEL: 'LLM',
  CHAIN: 'CHAIN',
  AGENT: 'AGENT',
  TOOL: 'TOOL',
  RETRIEVER: 'RETRIEVER',
  EMBEDDING: 'EMBEDDING',
  RERANKER: 'RERANKER',
  UNKNOWN: undefined,
};

/** MLflow stores the span type as JSON text, e.g. "\"LLM\"". Types without a kind of their own keep their name. */
export function getMlflowKind(tags: KeyValuePair[]): string | undefined {
  const raw = parseJson(attr(tags, 'mlflow.spanType'));
  const type = textOf(raw)?.toUpperCase();
  if (!type) {
    return undefined;
  }
  return type in MLFLOW_KINDS ? MLFLOW_KINDS[type] : type;
}

/** Reads mlflow.spanInputs and mlflow.spanOutputs. */
export function extractMlflow(tags: KeyValuePair[]): FrameworkSpan | undefined {
  if (!hasMlflowSignature(tags)) {
    return undefined;
  }
  const kind = getMlflowKind(tags);
  return { ...(kind ? { kind } : {}), input: attr(tags, 'mlflow.spanInputs'), output: attr(tags, 'mlflow.spanOutputs') };
}

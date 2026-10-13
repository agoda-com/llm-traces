// Synthetic OTLP traces for tracing conventions other than OpenInference. Attribute shapes follow the
// public OTel GenAI semantic conventions and the documented output of each framework; the content is made up.

type OtlpValue =
  | { stringValue: string }
  | { intValue: string }
  | { doubleValue: number }
  | { boolValue: boolean }
  | { arrayValue: { values: OtlpValue[] } }
  | { kvlistValue: { values: Array<{ key: string; value: OtlpValue }> } };

export type AttrValue = string | number | boolean | AttrValue[] | { [key: string]: AttrValue };

export function toOtlpValue(value: AttrValue): OtlpValue {
  if (typeof value === 'string') {
    return { stringValue: value };
  }
  if (typeof value === 'boolean') {
    return { boolValue: value };
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toOtlpValue) } };
  }
  return { kvlistValue: { values: Object.entries(value).map(([key, entry]) => ({ key, value: toOtlpValue(entry) })) } };
}

export function attrs(values: Record<string, AttrValue>): Array<{ key: string; value: OtlpValue }> {
  return Object.entries(values).map(([key, value]) => ({ key, value: toOtlpValue(value) }));
}

const BASE_MS = 1741900000000;
const nano = (offsetMs: number) => String(BigInt(BASE_MS + offsetMs) * 1000000n);

export interface FixtureEvent {
  offsetMs: number;
  name: string;
  attributes: Record<string, AttrValue>;
}

export interface FixtureSpan {
  spanId: string;
  parentSpanId?: string;
  name: string;
  startMs: number;
  endMs: number;
  attributes: Record<string, AttrValue>;
  events?: FixtureEvent[];
}

export function buildTrace(traceId: string, scope: { name: string; version?: string }, spans: FixtureSpan[], serviceName = 'agent-service') {
  return {
    resourceSpans: [
      {
        resource: { attributes: attrs({ 'service.name': serviceName }) },
        scopeSpans: [
          {
            scope,
            spans: spans.map((span) => ({
              traceId,
              spanId: span.spanId,
              parentSpanId: span.parentSpanId ?? '',
              name: span.name,
              startTimeUnixNano: nano(span.startMs),
              endTimeUnixNano: nano(span.endMs),
              attributes: attrs(span.attributes),
              events: (span.events ?? []).map((event) => ({
                timeUnixNano: nano(event.offsetMs),
                name: event.name,
                attributes: attrs(event.attributes),
              })),
            })),
          },
        ],
      },
    ],
  };
}

export const CONVENTION_TRACE_ID = 'conv0001conv0001conv0001conv0001';

export const CONVENTION_SEARCH_RESPONSE = {
  traces: [
    {
      traceID: CONVENTION_TRACE_ID,
      rootServiceName: 'agent-service',
      rootTraceName: 'weather_agent',
      startTimeUnixNano: nano(0),
      durationMs: 2000,
      spanSets: [],
    },
  ],
};

// ---------------------------------------------------------------------------
// Area 1: OTel GenAI span events and the newest semantic conventions
// ---------------------------------------------------------------------------

const TOOL_CALL = [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } }];

export const GENAI_EVENTS_TRACE = buildTrace(CONVENTION_TRACE_ID, { name: 'example.genai', version: '1.0.0' }, [
  {
    spanId: 'evspan0000000001',
    name: 'chat model-a',
    startMs: 0,
    endMs: 900,
    attributes: {
      'gen_ai.operation.name': 'chat',
      'gen_ai.system': 'example',
      'gen_ai.request.model': 'model-a',
      'gen_ai.usage.input_tokens': 40,
      'gen_ai.usage.output_tokens': 12,
    },
    events: [
      { offsetMs: 5, name: 'gen_ai.system.message', attributes: { content: 'You answer weather questions.' } },
      { offsetMs: 6, name: 'gen_ai.user.message', attributes: { content: 'Weather in Paris?' } },
      { offsetMs: 7, name: 'gen_ai.assistant.message', attributes: { tool_calls: JSON.stringify(TOOL_CALL) } },
      { offsetMs: 8, name: 'gen_ai.tool.message', attributes: { id: 'call_1', content: 'Sunny, 22C' } },
      {
        offsetMs: 880,
        name: 'gen_ai.choice',
        attributes: {
          index: 0,
          finish_reason: 'stop',
          message: JSON.stringify({ role: 'assistant', content: 'It is sunny in Paris today.' }),
        },
      },
    ],
  },
  {
    spanId: 'evspan0000000002',
    name: 'chat model-a',
    startMs: 1000,
    endMs: 1900,
    attributes: {
      'gen_ai.operation.name': 'chat',
      'gen_ai.system': 'example',
      'gen_ai.request.model': 'model-a',
      'gen_ai.system_instructions': JSON.stringify([{ type: 'text', content: 'Always answer in one sentence.' }]),
      'gen_ai.input.messages': JSON.stringify([{ role: 'user', parts: [{ type: 'text', content: 'Is it raining in Rome?' }] }]),
      'gen_ai.output.messages': JSON.stringify([
        { role: 'assistant', parts: [{ type: 'text', content: 'No, it is dry in Rome.' }], finish_reason: 'stop' },
      ]),
    },
  },
  {
    spanId: 'evspan0000000003',
    name: 'chat model-a',
    startMs: 1950,
    endMs: 2000,
    attributes: { 'gen_ai.operation.name': 'chat', 'gen_ai.request.model': 'model-a' },
    events: [
      {
        offsetMs: 1990,
        name: 'gen_ai.client.inference.operation.details',
        attributes: {
          'gen_ai.system_instructions': JSON.stringify([{ type: 'text', content: 'Reply with a single word.' }]),
          'gen_ai.input.messages': JSON.stringify([{ role: 'user', parts: [{ type: 'text', content: 'Capital of Italy?' }] }]),
          'gen_ai.output.messages': JSON.stringify([
            { role: 'assistant', parts: [{ type: 'text', content: 'Rome' }], finish_reason: 'stop' },
          ]),
        },
      },
    ],
  },
]);

// ---------------------------------------------------------------------------
// Area 2: tool spans per OTel GenAI
// ---------------------------------------------------------------------------

export const GENAI_TOOL_TRACE = buildTrace(CONVENTION_TRACE_ID, { name: 'example.genai', version: '1.0.0' }, [
  {
    spanId: 'toolspan00000001',
    name: 'execute_tool get_weather',
    startMs: 100,
    endMs: 400,
    attributes: {
      'gen_ai.operation.name': 'execute_tool',
      'gen_ai.tool.name': 'get_weather',
      'gen_ai.tool.call.id': 'call_weather_1',
      'gen_ai.tool.description': 'Get the current weather for a city',
      'gen_ai.tool.type': 'function',
      'gen_ai.tool.call.arguments': '{"city":"Paris","unit":"celsius"}',
      'gen_ai.tool.call.result': '{"temperature":21,"conditions":"sunny"}',
    },
  },
  {
    spanId: 'toolspan00000002',
    name: 'running tool',
    startMs: 500,
    endMs: 700,
    attributes: {
      'gen_ai.tool.name': 'search_docs',
      'gen_ai.tool.call.id': 'call_search_2',
      'gen_ai.tool.call.arguments': '{"query":"rate limits","max_results":3}',
      'gen_ai.tool.call.result': '["doc-a","doc-b"]',
    },
  },
]);

// ---------------------------------------------------------------------------
// Area 3: structured attribute values and instrumentation scope
// ---------------------------------------------------------------------------

export const STRUCTURED_ATTRIBUTES_TRACE = buildTrace(CONVENTION_TRACE_ID, { name: 'example.genai', version: '2.3.4' }, [
  {
    spanId: 'structspan000001',
    name: 'chat model-a',
    startMs: 0,
    endMs: 800,
    attributes: {
      'gen_ai.operation.name': 'chat',
      'gen_ai.request.model': 'model-a',
      'gen_ai.system_instructions': [{ type: 'text', content: 'Answer in French.' }],
      'gen_ai.input.messages': [{ role: 'user', parts: [{ type: 'text', content: 'Say hello.' }] }],
      'gen_ai.output.messages': [{ role: 'assistant', parts: [{ type: 'text', content: 'Bonjour.' }], finish_reason: 'stop' }],
      'gen_ai.response.finish_reasons': ['stop'],
      'gen_ai.tool.definitions': [
        { type: 'function', name: 'translate', description: 'Translate text', parameters: { type: 'object', properties: { text: { type: 'string' } } } },
      ],
      'custom.labels': ['alpha', 'beta'],
      'custom.settings': { region: 'eu', retries: 2 },
    },
  },
]);

// ---------------------------------------------------------------------------
// Area 4: Vercel AI SDK (instrumentation scope "ai")
// ---------------------------------------------------------------------------

export const VERCEL_AI_TRACE = buildTrace(CONVENTION_TRACE_ID, { name: 'ai', version: '5.0.0' }, [
  {
    spanId: 'aispan0000000001',
    name: 'ai.generateText',
    startMs: 0,
    endMs: 1800,
    attributes: {
      'operation.name': 'ai.generateText weather-agent',
      'ai.operationId': 'ai.generateText',
      'ai.telemetry.functionId': 'weather-agent',
      'ai.model.id': 'model-a',
      'ai.model.provider': 'example.chat',
      'ai.prompt': JSON.stringify({ system: 'You help with weather.', prompt: 'What is the weather in Paris?' }),
      'ai.response.text': 'It is 21 degrees and sunny in Paris.',
      'ai.usage.inputTokens': 180,
      'ai.usage.outputTokens': 40,
    },
  },
  {
    spanId: 'aispan0000000002',
    parentSpanId: 'aispan0000000001',
    name: 'ai.generateText.doGenerate',
    startMs: 50,
    endMs: 700,
    attributes: {
      'operation.name': 'ai.generateText.doGenerate weather-agent',
      'ai.operationId': 'ai.generateText.doGenerate',
      'ai.telemetry.functionId': 'weather-agent',
      'ai.model.id': 'model-a',
      'ai.model.provider': 'example.chat',
      'ai.prompt.messages': JSON.stringify([
        { role: 'system', content: 'You help with weather.' },
        { role: 'user', content: [{ type: 'text', text: 'What is the weather in Paris?' }] },
      ]),
      'ai.prompt.tools': [
        JSON.stringify({
          type: 'function',
          name: 'getWeather',
          description: 'Get the weather in a location',
          inputSchema: { type: 'object', properties: { location: { type: 'string' } }, required: ['location'] },
        }),
      ],
      'ai.prompt.toolChoice': '{"type":"auto"}',
      'ai.settings.maxRetries': 2,
      'ai.response.toolCalls': JSON.stringify([{ toolCallId: 'call_w1', toolName: 'getWeather', input: '{"location":"Paris"}' }]),
      'ai.response.finishReason': 'tool-calls',
      'ai.usage.inputTokens': 90,
      'ai.usage.outputTokens': 15,
      'gen_ai.system': 'example.chat',
      'gen_ai.request.model': 'model-a',
    },
  },
  {
    spanId: 'aispan0000000003',
    parentSpanId: 'aispan0000000001',
    name: 'ai.toolCall',
    startMs: 720,
    endMs: 900,
    attributes: {
      'operation.name': 'ai.toolCall weather-agent',
      'ai.operationId': 'ai.toolCall',
      'ai.toolCall.name': 'getWeather',
      'ai.toolCall.id': 'call_w1',
      'ai.toolCall.args': '{"location":"Paris"}',
      'ai.toolCall.result': '{"temperature":21,"conditions":"sunny"}',
    },
  },
  {
    spanId: 'aispan0000000004',
    parentSpanId: 'aispan0000000001',
    name: 'ai.generateText.doGenerate',
    startMs: 920,
    endMs: 1750,
    attributes: {
      'operation.name': 'ai.generateText.doGenerate weather-agent',
      'ai.operationId': 'ai.generateText.doGenerate',
      'ai.model.id': 'model-a',
      'ai.prompt.messages': JSON.stringify([
        { role: 'user', content: [{ type: 'text', text: 'What is the weather in Paris?' }] },
        { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'call_w1', toolName: 'getWeather', input: { location: 'Paris' } }] },
        { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call_w1', toolName: 'getWeather', output: { type: 'json', value: { temperature: 21 } } }] },
      ]),
      'ai.response.text': 'It is 21 degrees and sunny in Paris.',
      'ai.response.finishReason': 'stop',
      'ai.usage.inputTokens': 90,
      'ai.usage.outputTokens': 25,
      'gen_ai.system': 'example.chat',
      'gen_ai.request.model': 'model-a',
    },
  },
]);

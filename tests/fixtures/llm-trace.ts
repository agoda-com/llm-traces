// Realistic OpenInference trace fixture for testing the LLM Trace Explorer plugin.
// Structure: CHAIN (root) -> LLM -> TOOL -> LLM (follow-up)

const TRACE_ID = '4829080550953998599aabbccdd1234';
const t = (offsetMs: number) => String(BigInt(1741900000000 + offsetMs) * 1000000n);

export const SEARCH_RESPONSE = {
  traces: [
    {
      traceID: TRACE_ID,
      rootServiceName: 'llm-service',
      rootTraceName: 'process_query',
      startTimeUnixNano: t(0),
      durationMs: 2340,
      spanSets: [],
    },
    {
      traceID: 'aaabbbccc111222333444555666777',
      rootServiceName: 'agent-service',
      rootTraceName: 'generate_content',
      startTimeUnixNano: t(60000),
      durationMs: 1820,
      spanSets: [],
    },
  ],
};

// Full OTLP trace — OpenInference convention
export const TRACE_RESPONSE = {
  resourceSpans: [
    {
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: 'llm-service' } },
          { key: 'service.version', value: { stringValue: '2.3.1' } },
          { key: 'deployment.environment', value: { stringValue: 'production' } },
        ],
      },
      scopeSpans: [
        {
          spans: [
            // Root CHAIN span
            {
              traceId: TRACE_ID,
              spanId: 'span0001',
              parentSpanId: '',
              name: 'process_query',
              startTimeUnixNano: t(0),
              endTimeUnixNano: t(2340),
              attributes: [
                { key: 'openinference.span.kind', value: { stringValue: 'CHAIN' } },
                { key: 'input.value', value: { stringValue: 'What are the amenities at hotel 12345?' } },
                { key: 'output.value', value: { stringValue: 'Hotel 12345 has a pool, gym, spa, and 3 restaurants.' } },
                { key: 'session.id', value: { stringValue: 'sess_abc123' } },
              ],
              events: [],
            },
            // First LLM span — initial analysis
            {
              traceId: TRACE_ID,
              spanId: 'span0002',
              parentSpanId: 'span0001',
              name: 'llm claude-sonnet-4-5',
              startTimeUnixNano: t(50),
              endTimeUnixNano: t(980),
              attributes: [
                { key: 'openinference.span.kind', value: { stringValue: 'LLM' } },
                { key: 'llm.model_name', value: { stringValue: 'claude-sonnet-4-5' } },
                { key: 'llm.system', value: { stringValue: 'anthropic' } },
                { key: 'llm.invocation_parameters', value: { stringValue: '{"temperature":0.3,"max_tokens":1024}' } },
                { key: 'llm.input_messages.0.message.role', value: { stringValue: 'system' } },
                { key: 'llm.input_messages.0.message.content', value: { stringValue: 'You are an expert hotel concierge assistant. Answer questions about hotel properties accurately and helpfully. Use the available tools to look up property details. You have access to a comprehensive database of hotel properties worldwide. When answering questions, always provide specific, actionable information. If a guest asks about amenities, list them clearly and mention any notable features. For pricing questions, provide ranges and note that prices may vary by season. Always maintain a professional, friendly tone that reflects the high standards of the properties you represent. Remember to check for any current promotions or special offers that might benefit the guest.' } },
                { key: 'llm.input_messages.1.message.role', value: { stringValue: 'user' } },
                // Python SDK ensure_ascii=True produces literal \uXXXX escapes — should decode to Chinese
                { key: 'llm.input_messages.1.message.content', value: { stringValue: '\\u8bf7\\u95ee\\u9152\\u5e97 12345 \\u7684\\u8bbe\\u65bd\\u662f\\u4ec0\\u4e48\\uff1f' } },
                { key: 'llm.output_messages.0.message.role', value: { stringValue: 'assistant' } },
                { key: 'llm.output_messages.0.message.content', value: { stringValue: "I'll look up the property details for hotel 12345 to give you accurate information about their amenities." } },
                { key: 'llm.output_messages.0.message.tool_calls', value: { stringValue: '[{"id":"call_xyz1","function":{"name":"get_property_details","arguments":"{\\"hotel_id\\":12345}"}}]' } },
                { key: 'llm.token_count.prompt', value: { intValue: '312' } },
                { key: 'llm.token_count.completion', value: { intValue: '48' } },
                { key: 'llm.token_count.total', value: { intValue: '360' } },
              ],
              events: [],
            },
            // TOOL span — property lookup
            {
              traceId: TRACE_ID,
              spanId: 'span0003',
              parentSpanId: 'span0002',
              name: 'get_property_details',
              startTimeUnixNano: t(990),
              endTimeUnixNano: t(1350),
              attributes: [
                { key: 'openinference.span.kind', value: { stringValue: 'TOOL' } },
                { key: 'tool.name', value: { stringValue: 'get_property_details' } },
                { key: 'tool.description', value: { stringValue: 'Retrieve detailed information about a hotel property by ID' } },
                { key: 'input.value', value: { stringValue: '{"hotel_id":12345}' } },
                { key: 'output.value', value: { stringValue: '{"hotel_id":12345,"name":"Grand Sukhumvit Bangkok","amenities":["pool","gym","spa","3 restaurants","concierge","valet parking"],"stars":5,"rooms":342}' } },
              ],
              events: [],
            },
            // Non-AI HTTP span — no openinference.span.kind, for testing AI Only filter
            {
              traceId: TRACE_ID,
              spanId: 'span0005',
              parentSpanId: 'span0001',
              name: 'HTTP GET /api/hotels',
              startTimeUnixNano: t(100),
              endTimeUnixNano: t(900),
              attributes: [
                { key: 'http.method', value: { stringValue: 'GET' } },
                { key: 'http.url', value: { stringValue: '/api/hotels/12345' } },
                { key: 'http.status_code', value: { intValue: '200' } },
              ],
              events: [],
            },
            // Second LLM span — final answer with tool result (max_tokens finish reason for testing)
            {
              traceId: TRACE_ID,
              spanId: 'span0004',
              parentSpanId: 'span0001',
              name: 'llm claude-sonnet-4-5',
              startTimeUnixNano: t(1360),
              endTimeUnixNano: t(2320),
              attributes: [
                { key: 'openinference.span.kind', value: { stringValue: 'LLM' } },
                { key: 'llm.model_name', value: { stringValue: 'claude-sonnet-4-5' } },
                { key: 'llm.system', value: { stringValue: 'anthropic' } },
                { key: 'llm.invocation_parameters', value: { stringValue: '{"temperature":0.3,"max_tokens":1024}' } },
                { key: 'llm.input_messages.0.message.role', value: { stringValue: 'system' } },
                { key: 'llm.input_messages.0.message.content', value: { stringValue: 'You are an expert hotel concierge assistant. Answer questions about hotel properties accurately and helpfully. Use the available tools to look up property details.' } },
                { key: 'llm.input_messages.1.message.role', value: { stringValue: 'user' } },
                { key: 'llm.input_messages.1.message.content', value: { stringValue: 'What are the amenities at hotel 12345?' } },
                { key: 'llm.input_messages.2.message.role', value: { stringValue: 'assistant' } },
                { key: 'llm.input_messages.2.message.content', value: { stringValue: "I'll look up the property details for hotel 12345 to give you accurate information about their amenities." } },
                { key: 'llm.input_messages.3.message.role', value: { stringValue: 'tool' } },
                { key: 'llm.input_messages.3.message.content', value: { stringValue: '{"hotel_id":12345,"name":"Grand Sukhumvit Bangkok","amenities":["pool","gym","spa","3 restaurants","concierge","valet parking"],"stars":5,"rooms":342}' } },
                { key: 'llm.output_messages.0.message.role', value: { stringValue: 'assistant' } },
                { key: 'llm.output_messages.0.message.content', value: { stringValue: 'Hotel 12345 (Grand Sukhumvit Bangkok) is a 5-star property with 342 rooms. The amenities include:\n\n• Swimming pool\n• Fitness center / gym\n• Full-service spa\n• 3 restaurants\n• Concierge service\n• Valet parking' } },
                { key: 'llm.output_messages.0.message.finish_reason', value: { stringValue: 'max_tokens' } },
                { key: 'llm.token_count.prompt', value: { intValue: '428' } },
                { key: 'llm.token_count.completion', value: { intValue: '89' } },
                { key: 'llm.token_count.total', value: { intValue: '517' } },
              ],
              events: [],
            },
            // AGENT span — for testing agent name label display
            {
              traceId: TRACE_ID,
              spanId: 'span0007',
              parentSpanId: 'span0001',
              name: 'invoke_agent my_agent',
              startTimeUnixNano: t(100),
              endTimeUnixNano: t(500),
              attributes: [
                { key: 'openinference.span.kind', value: { stringValue: 'AGENT' } },
                { key: 'gen_ai.agent.name', value: { stringValue: 'my_agent' } },
                { key: 'gen_ai.operation.name', value: { stringValue: 'invoke_agent' } },
              ],
              events: [],
            },
            // Error span — uses OTLP status object (the real wire format, not attributes)
            {
              traceId: TRACE_ID,
              spanId: 'span0006',
              parentSpanId: 'span0001',
              name: 'failing_operation',
              startTimeUnixNano: t(1500),
              endTimeUnixNano: t(1600),
              attributes: [],
              status: { code: 'STATUS_CODE_ERROR', message: 'Connection timeout after 100ms' },
              events: [],
            },
            // GUARDRAIL span - policy check using OpenInference guardrail attributes
            // Rendered as LLM panel because guardrails invoke an LLM internally.
            {
              traceId: TRACE_ID,
              spanId: 'span0008',
              parentSpanId: 'span0001',
              name: 'guardrail no_prompt_disclosure',
              startTimeUnixNano: t(40),
              endTimeUnixNano: t(48),
              attributes: [
                { key: 'openinference.span.kind', value: { stringValue: 'GUARDRAIL' } },
                { key: 'guardrail.item', value: { stringValue: 'no_prompt_disclosure' } },
                { key: 'guardrail.trigger.action', value: { stringValue: 'MONITOR' } },
                { key: 'llm.model_name', value: { stringValue: 'gemini-2.0-flash' } },
                { key: 'llm.system', value: { stringValue: 'google' } },
                { key: 'llm.input_messages.0.message.role', value: { stringValue: 'system' } },
                { key: 'llm.input_messages.0.message.content', value: { stringValue: 'You are a security analyst. Check whether the input violates the guardrail no_prompt_disclosure.' } },
                { key: 'llm.input_messages.1.message.role', value: { stringValue: 'user' } },
                { key: 'llm.input_messages.1.message.content', value: { stringValue: 'What are the amenities at hotel 12345?' } },
                { key: 'llm.output_messages.0.message.role', value: { stringValue: 'assistant' } },
                { key: 'llm.output_messages.0.message.content', value: { stringValue: '{"should_block": false}' } },
                { key: 'llm.token_count.prompt', value: { intValue: '89' } },
                { key: 'llm.token_count.completion', value: { intValue: '8' } },
                { key: 'llm.token_count.total', value: { intValue: '97' } },
              ],
              events: [],
            },
            // UNKNOWN span — OI span kind is set but not recognized
            {
              traceId: TRACE_ID,
              spanId: 'span0009',
              parentSpanId: 'span0001',
              name: 'custom_processor',
              startTimeUnixNano: t(60),
              endTimeUnixNano: t(120),
              attributes: [
                { key: 'openinference.span.kind', value: { stringValue: 'UNKNOWN' } },
                { key: 'input.value', value: { stringValue: 'raw input payload' } },
                { key: 'output.value', value: { stringValue: 'processed output' } },
              ],
              events: [],
            },
          ],
        },
      ],
    },
  ],
};

const STRUCTURED_TRACE_ID = 'structured00112233445566778899aa';

export const STRUCTURED_SEARCH_RESPONSE = {
  traces: [
    {
      traceID: STRUCTURED_TRACE_ID,
      rootServiceName: 'chat-agent',
      rootTraceName: 'ChatCompletion',
      startTimeUnixNano: '1767225600000000000',
      durationMs: 3223,
      spanSets: [],
    },
  ],
};

export const STRUCTURED_TRACE_RESPONSE = {
  resourceSpans: [
    {
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: 'chat-agent' } },
        ],
      },
      scopeSpans: [
        {
          spans: [
            {
              traceId: STRUCTURED_TRACE_ID,
              spanId: 'structspan000001',
              parentSpanId: '',
              name: 'ChatCompletion',
              startTimeUnixNano: '1767225600000000000',
              endTimeUnixNano: '1767225603222315301',
              attributes: [
                { key: 'openinference.span.kind', value: { stringValue: 'LLM' } },
                { key: 'llm.model_name', value: { stringValue: 'claude-sonnet-4-5' } },
                { key: 'llm.input_messages.1.message.role', value: { stringValue: 'user' } },
                { key: 'llm.input_messages.1.message.contents.0.message_content.type', value: { stringValue: 'text' } },
                { key: 'llm.input_messages.1.message.contents.0.message_content.text', value: { stringValue: '## User\n- **Name:** example_user\n\nPlease answer the question below.' } },
                { key: 'llm.input_messages.2.message.role', value: { stringValue: 'user' } },
                { key: 'llm.input_messages.2.message.contents.0.message_content.type', value: { stringValue: 'text' } },
                { key: 'llm.input_messages.2.message.contents.0.message_content.text', value: { stringValue: 'Please look into ticket PROJ-123 and answer the question.' } },
                { key: 'llm.output_messages.0.message.role', value: { stringValue: 'assistant' } },
                { key: 'llm.output_messages.0.message.tool_calls.0.tool_call.id', value: { stringValue: 'tooluse_example0001' } },
                { key: 'llm.output_messages.0.message.tool_calls.0.tool_call.function.name', value: { stringValue: 'transfer_to_agent' } },
                { key: 'llm.output_messages.0.message.tool_calls.0.tool_call.function.arguments', value: { stringValue: '{}' } },
                { key: 'llm.token_count.prompt', value: { intValue: '6871' } },
                { key: 'llm.token_count.completion', value: { intValue: '67' } },
                { key: 'llm.token_count.total', value: { intValue: '6938' } },
              ],
              events: [],
            },
          ],
        },
      ],
    },
  ],
};

const TOOL_VISUALIZATION_TRACE_ID = 'toolvisualization0011223344556677';
const jiraDefinition = {
  type: 'function',
  function: {
    name: 'get_jira_issue',
    description: 'Get one Jira issue with selected fields.',
    parameters: {
      type: 'object',
      properties: {
        issue_key: { type: 'string', description: 'Jira issue key.' },
        fields: { type: 'array', items: { type: 'string' }, default: ['summary'], description: 'Fields to return.' },
      },
      required: ['issue_key'],
    },
    strict: false,
  },
};
const memoryDefinition = {
  type: 'function',
  function: {
    name: 'save_memory',
    description: 'Save a memory for future sessions.',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Memory content.' },
        memory_type: { type: 'string', default: 'knowledge', description: 'Retention policy for the saved memory.' },
        metadata: { anyOf: [{ type: 'object' }, { type: 'null' }], default: null, description: 'Optional context.' },
      },
      required: ['content'],
    },
  },
};
const largeJiraResult = JSON.stringify({
  key: 'PROJ-123',
  fields: {
    summary: 'Example issue summary',
    status: { name: 'In Progress' },
    reporter: { displayName: 'Example User' },
    description: {
      type: 'doc',
      content: Array.from({ length: 16 }, (_, index) => ({
        type: 'paragraph',
        content: [{ type: 'text', text: `Detailed Jira result line ${index + 1}` }],
      })),
    },
  },
});

export const TOOL_VISUALIZATION_SEARCH_RESPONSE = {
  traces: [{
    traceID: TOOL_VISUALIZATION_TRACE_ID,
    rootServiceName: 'tool-service',
    rootTraceName: 'ChatCompletion',
    startTimeUnixNano: '1767225600000000000',
    durationMs: 2200,
    spanSets: [],
  }],
};

export const TOOL_VISUALIZATION_TRACE_RESPONSE = {
  resourceSpans: [{
    resource: { attributes: [{ key: 'service.name', value: { stringValue: 'tool-service' } }] },
    scopeSpans: [{
      spans: [{
        traceId: TOOL_VISUALIZATION_TRACE_ID,
        spanId: 'toolspan00000001',
        parentSpanId: '',
        name: 'ChatCompletion',
        startTimeUnixNano: '1767225600000000000',
        endTimeUnixNano: '1767225602200000000',
        attributes: [
          { key: 'openinference.span.kind', value: { stringValue: 'LLM' } },
          { key: 'llm.model_name', value: { stringValue: 'claude-sonnet-4-5' } },
          { key: 'llm.tools.0.tool.json_schema', value: { stringValue: JSON.stringify(jiraDefinition) } },
          { key: 'llm.tools.1.tool.json_schema', value: { stringValue: JSON.stringify(memoryDefinition) } },
          { key: 'llm.tools.2.tool.json_schema', value: { stringValue: '{broken' } },
          { key: 'llm.input_messages.0.message.role', value: { stringValue: 'user' } },
          { key: 'llm.input_messages.0.message.content', value: { stringValue: 'Inspect PROJ-123.' } },
          { key: 'llm.input_messages.1.message.role', value: { stringValue: 'assistant' } },
          { key: 'llm.input_messages.1.message.tool_calls.0.tool_call.id', value: { stringValue: 'call_jira_1' } },
          { key: 'llm.input_messages.1.message.tool_calls.0.tool_call.function.name', value: { stringValue: 'get_jira_issue' } },
          { key: 'llm.input_messages.1.message.tool_calls.0.tool_call.function.arguments', value: { stringValue: '{"issue_key":"PROJ-123","fields":["summary","status","description"]}' } },
          { key: 'llm.input_messages.2.message.role', value: { stringValue: 'tool' } },
          { key: 'llm.input_messages.2.message.tool_call_id', value: { stringValue: 'call_jira_1' } },
          { key: 'llm.input_messages.2.message.contents.0.message_content.type', value: { stringValue: 'text' } },
          { key: 'llm.input_messages.2.message.contents.0.message_content.text', value: { stringValue: largeJiraResult } },
          { key: 'llm.input_messages.3.message.role', value: { stringValue: 'assistant' } },
          { key: 'llm.input_messages.3.message.tool_calls.0.tool_call.id', value: { stringValue: 'call_bad_args' } },
          { key: 'llm.input_messages.3.message.tool_calls.0.tool_call.function.name', value: { stringValue: 'custom_tool' } },
          { key: 'llm.input_messages.3.message.tool_calls.0.tool_call.function.arguments', value: { stringValue: '{broken-arguments' } },
          { key: 'llm.input_messages.4.message.role', value: { stringValue: 'tool' } },
          { key: 'llm.input_messages.4.message.tool_call_id', value: { stringValue: 'orphan_result' } },
          { key: 'llm.input_messages.4.message.content', value: { stringValue: 'not-json-result' } },
          { key: 'llm.output_messages.0.message.role', value: { stringValue: 'assistant' } },
          { key: 'llm.output_messages.0.message.contents.0.message_content.type', value: { stringValue: 'reasoning' } },
          { key: 'llm.output_messages.0.message.contents.0.message_content.text', value: { stringValue: 'I need one more status check.' } },
          { key: 'llm.output_messages.0.message.contents.1.message_content.type', value: { stringValue: 'tool_use' } },
          { key: 'llm.output_messages.0.message.contents.1.tool_call.id', value: { stringValue: 'call_status_1' } },
          { key: 'llm.output_messages.0.message.contents.1.tool_call.function.name', value: { stringValue: 'get_jira_issue' } },
          { key: 'llm.output_messages.0.message.contents.1.tool_call.function.arguments', value: { stringValue: '{"issue_key":"PROJ-123","fields":["status"]}' } },
          { key: 'llm.output_messages.0.message.contents.2.message_content.type', value: { stringValue: 'text' } },
          { key: 'llm.output_messages.0.message.contents.2.message_content.text', value: { stringValue: 'Checking the Jira status now.' } },
          { key: 'llm.output_messages.0.message.tool_calls.0.tool_call.id', value: { stringValue: 'call_status_1' } },
          { key: 'llm.output_messages.0.message.tool_calls.0.tool_call.function.name', value: { stringValue: 'wrong_duplicate_name' } },
          { key: 'llm.output_messages.0.message.tool_calls.0.tool_call.function.arguments', value: { stringValue: '{}' } },
          { key: 'llm.output_messages.1.message.role', value: { stringValue: 'tool' } },
          { key: 'llm.output_messages.1.message.tool_call_id', value: { stringValue: 'call_status_1' } },
          { key: 'llm.output_messages.1.message.content', value: { stringValue: '{"status":"In Progress"}' } },
        ],
        events: [],
      }],
    }],
  }],
};

// ---------------------------------------------------------------------------
// GCP Vertex AI trace fixture (gen_ai.system=vertex_ai + llm.prompts/completions)
// ---------------------------------------------------------------------------

const VERTEX_TRACE_ID = 'vertex00112233445566778899aabbcc';
const tv = (offsetMs: number) => String(BigInt(1741900000000 + offsetMs) * 1000000n);

export const VERTEX_TRACE_RESPONSE = {
  resourceSpans: [
    {
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: 'llm-service' } },
          { key: 'deployment.environment', value: { stringValue: 'production' } },
        ],
      },
      scopeSpans: [
        {
          spans: [
            // Root CHAIN span
            {
              traceId: VERTEX_TRACE_ID,
              spanId: 'vspan0001',
              parentSpanId: '',
              name: 'process_query',
              startTimeUnixNano: tv(0),
              endTimeUnixNano: tv(3100),
              attributes: [
                { key: 'openinference.span.kind', value: { stringValue: 'CHAIN' } },
                { key: 'input.value', value: { stringValue: 'Describe the Eiffel Tower.' } },
                { key: 'output.value', value: { stringValue: 'The Eiffel Tower is an iconic iron lattice tower in Paris.' } },
                { key: 'session.id', value: { stringValue: 'sess_vertex_001' } },
              ],
              events: [],
            },
            // Vertex AI LLM span using gen_ai.system=vertex_ai and llm.prompts / llm.completions
            {
              traceId: VERTEX_TRACE_ID,
              spanId: 'vspan0002',
              parentSpanId: 'vspan0001',
              name: 'gemini-1.5-pro',
              startTimeUnixNano: tv(100),
              endTimeUnixNano: tv(2900),
              attributes: [
                { key: 'gen_ai.system', value: { stringValue: 'vertex_ai' } },
                { key: 'gen_ai.request.model', value: { stringValue: 'gemini-1.5-pro' } },
                { key: 'llm.prompts.0.role', value: { stringValue: 'user' } },
                { key: 'llm.prompts.0.content', value: { stringValue: 'Describe the Eiffel Tower.' } },
                { key: 'llm.completions.0.role', value: { stringValue: 'model' } },
                { key: 'llm.completions.0.content', value: { stringValue: 'The Eiffel Tower is an iconic iron lattice tower on the Champ de Mars in Paris, France. It was constructed from 1887 to 1889 as the centerpiece of the 1889 World\'s Fair.' } },
                { key: 'llm.token_count.prompt', value: { intValue: '9' } },
                { key: 'llm.token_count.completion', value: { intValue: '42' } },
                { key: 'llm.token_count.total', value: { intValue: '51' } },
              ],
              events: [],
            },
          ],
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// OTel GenAI trace fixture (gen_ai.system=openai + span events)
// ---------------------------------------------------------------------------

const OTEL_TRACE_ID = 'otelgenai00112233445566778899aa';
const to = (offsetMs: number) => String(BigInt(1741900000000 + offsetMs) * 1000000n);

export const OTEL_GENAI_TRACE_RESPONSE = {
  resourceSpans: [
    {
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: 'agent-service' } },
          { key: 'deployment.environment', value: { stringValue: 'staging' } },
        ],
      },
      scopeSpans: [
        {
          spans: [
            // OTel GenAI LLM span using gen_ai attributes and span events for messages
            {
              traceId: OTEL_TRACE_ID,
              spanId: 'ospan0001',
              parentSpanId: '',
              name: 'generate_content',
              startTimeUnixNano: to(0),
              endTimeUnixNano: to(1800),
              attributes: [
                { key: 'gen_ai.system', value: { stringValue: 'openai' } },
                { key: 'gen_ai.request.model', value: { stringValue: 'gpt-4o' } },
                { key: 'gen_ai.request.temperature', value: { doubleValue: 0.6 } },
                { key: 'gen_ai.request.max_tokens', value: { intValue: '512' } },
                { key: 'gen_ai.usage.input_tokens', value: { intValue: '145' } },
                { key: 'gen_ai.usage.output_tokens', value: { intValue: '67' } },
                { key: 'gen_ai.response.finish_reasons.0', value: { stringValue: 'stop' } },
              ],
              // Span events carry the actual message content
              events: [
                {
                  timeUnixNano: to(10),
                  name: 'gen_ai.content.prompt',
                  attributes: [
                    { key: 'gen_ai.prompt', value: { stringValue: JSON.stringify([
                      { role: 'system', content: 'You are a helpful travel assistant.' },
                      { role: 'user', content: 'What are the top 3 attractions in Paris?' },
                    ]) } },
                  ],
                },
                {
                  timeUnixNano: to(1750),
                  name: 'gen_ai.content.completion',
                  attributes: [
                    { key: 'gen_ai.completion', value: { stringValue: 'The top 3 attractions in Paris are: 1. The Eiffel Tower, 2. The Louvre Museum, 3. Notre-Dame Cathedral.' } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Generic LLM trace fixture (no standard convention — uses operation.type)
// ---------------------------------------------------------------------------

const GENERIC_TRACE_ID = 'generic00112233445566778899aabb';
const tg = (offsetMs: number) => String(BigInt(1741900000000 + offsetMs) * 1000000n);

export const GENERIC_TRACE_RESPONSE = {
  resourceSpans: [
    {
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: 'llm-service' } },
          { key: 'deployment.environment', value: { stringValue: 'development' } },
        ],
      },
      scopeSpans: [
        {
          spans: [
            // Generic LLM span — uses operation.type and message-like JSON in input/output
            {
              traceId: GENERIC_TRACE_ID,
              spanId: 'gspan0001',
              parentSpanId: '',
              name: 'generate_content',
              startTimeUnixNano: tg(0),
              endTimeUnixNano: tg(950),
              attributes: [
                { key: 'operation.type', value: { stringValue: 'chat_completion' } },
                { key: 'model', value: { stringValue: 'my-custom-llm-v2' } },
                { key: 'temperature', value: { doubleValue: 0.8 } },
                { key: 'max_tokens', value: { intValue: '256' } },
                { key: 'input.value', value: { stringValue: JSON.stringify([
                  { role: 'system', content: 'You are a code review assistant.' },
                  { role: 'user', content: 'Review this function for bugs.' },
                ]) } },
                { key: 'output.value', value: { stringValue: JSON.stringify([
                  { role: 'assistant', content: 'The function looks correct. Consider adding null checks on line 5.' },
                ]) } },
                { key: 'prompt_tokens', value: { intValue: '38' } },
                { key: 'completion_tokens', value: { intValue: '22' } },
                { key: 'total_tokens', value: { intValue: '60' } },
                { key: 'finish_reason', value: { stringValue: 'stop' } },
              ],
              events: [],
            },
          ],
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Span status parsing fixture — one span per status format variant.
// Used by tests/span-status.spec.ts to cover all OTLP status code formats.
// ---------------------------------------------------------------------------

const STATUS_TRACE_ID = 'statustest0011223344556677889900';
const ts = (offsetMs: number) => String(BigInt(1741900000000 + offsetMs) * 1000000n);

export const STATUS_TEST_TRACE_RESPONSE = {
  resourceSpans: [
    {
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'status-test-svc' } }] },
      scopeSpans: [{
        spans: [
          // Root span (no error)
          {
            traceId: STATUS_TRACE_ID, spanId: 'st-root', parentSpanId: '',
            name: 'root_operation',
            startTimeUnixNano: ts(0), endTimeUnixNano: ts(5000),
            attributes: [], events: [],
          },
          // 1. STATUS_CODE_ERROR enum string + status message (standard OTel SDK format)
          {
            traceId: STATUS_TRACE_ID, spanId: 'st-err-enum', parentSpanId: 'st-root',
            name: 'error_via_enum_string',
            startTimeUnixNano: ts(10), endTimeUnixNano: ts(100),
            attributes: [], events: [],
            status: { code: 'STATUS_CODE_ERROR', message: 'enum string error message' },
          },
          // 2. Bare "ERROR" string (some SDKs omit the STATUS_CODE_ prefix)
          {
            traceId: STATUS_TRACE_ID, spanId: 'st-err-bare', parentSpanId: 'st-root',
            name: 'error_via_bare_string',
            startTimeUnixNano: ts(200), endTimeUnixNano: ts(300),
            attributes: [], events: [],
            status: { code: 'ERROR', message: 'bare string error message' },
          },
          // 3. Numeric code 2 (proto3 JSON encodes enums as numbers)
          {
            traceId: STATUS_TRACE_ID, spanId: 'st-err-num', parentSpanId: 'st-root',
            name: 'error_via_numeric_code',
            startTimeUnixNano: ts(400), endTimeUnixNano: ts(500),
            attributes: [], events: [],
            status: { code: 2, message: 'numeric code error message' },
          },
          // 4. otel.status_code as a span attribute (attribute-based fallback)
          {
            traceId: STATUS_TRACE_ID, spanId: 'st-err-attr', parentSpanId: 'st-root',
            name: 'error_via_attribute',
            startTimeUnixNano: ts(600), endTimeUnixNano: ts(700),
            attributes: [
              { key: 'otel.status_code', value: { stringValue: 'ERROR' } },
              { key: 'otel.status_description', value: { stringValue: 'attribute error message' } },
            ],
            events: [],
          },
          // 5. STATUS_CODE_OK — must NOT be treated as error
          {
            traceId: STATUS_TRACE_ID, spanId: 'st-ok', parentSpanId: 'st-root',
            name: 'ok_span',
            startTimeUnixNano: ts(800), endTimeUnixNano: ts(900),
            attributes: [], events: [],
            status: { code: 'STATUS_CODE_OK' },
          },
          // 6. No status at all — must NOT be treated as error
          {
            traceId: STATUS_TRACE_ID, spanId: 'st-none', parentSpanId: 'st-root',
            name: 'no_status_span',
            startTimeUnixNano: ts(1000), endTimeUnixNano: ts(1100),
            attributes: [], events: [],
          },
        ],
      }],
    },
  ],
};

// ---------------------------------------------------------------------------
// Deeply nested trace with a long span name at the deepest level
// ---------------------------------------------------------------------------

const DEEP_TRACE_ID = 'deepnesting00112233445566778899';

export const DEEP_NESTED_SEARCH_RESPONSE = {
  traces: [{
    traceID: DEEP_TRACE_ID,
    rootServiceName: 'agent-service',
    rootTraceName: 'agent run',
    startTimeUnixNano: '1787620694830469092',
    durationMs: 2200,
    spanSets: [],
  }],
};

export const DEEP_NESTED_TRACE_RESPONSE = {
  resourceSpans: [{
    resource: { attributes: [{ key: 'service.name', value: { stringValue: 'agent-service' } }] },
    scopeSpans: [{
      spans: Array.from({ length: 22 }, (_, depth) => ({
        traceId: DEEP_TRACE_ID,
        spanId: `deepspan${String(depth).padStart(8, '0')}`,
        parentSpanId: depth === 0 ? '' : `deepspan${String(depth - 1).padStart(8, '0')}`,
        name: depth === 21 ? 'Pydantic AI Claude loop with a very long operation name that cannot fit' : `agent step ${depth}`,
        startTimeUnixNano: String(BigInt('1787620694830469092') + BigInt(depth) * 1000000n),
        endTimeUnixNano: String(BigInt('1787620697030469092') - BigInt(depth) * 1000000n),
        attributes: [
          { key: 'openinference.span.kind', value: { stringValue: depth === 21 ? 'LLM' : 'AGENT' } },
          { key: 'llm.model_name', value: { stringValue: 'bedrock-claude-sonnet-5' } },
        ],
        events: [],
      })),
    }],
  }],
};

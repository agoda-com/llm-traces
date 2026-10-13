// Synthetic multi-agent trace: a coordinator agent hands work to two sub-agents, and one sub-agent hands work to
// a third. Each agent owns LLM and tool spans. Agent names come from three different conventions on purpose.

export const AGENT_TRACE_ID = 'cc11dd22ee33ff44005511662277aa88';

const BASE_MS = 1741900000000;
const t = (offsetMs: number) => String(BigInt(BASE_MS + offsetMs) * 1000000n);
const str = (key: string, value: string) => ({ key, value: { stringValue: value } });

export const AGENT_SPAN_IDS = {
  root: 'ag000001',
  coordinator: 'ag000002',
  coordinatorLlm: 'ag000003',
  flightPlanner: 'ag000004',
  flightLlm: 'ag000005',
  flightTool: 'ag000006',
  hotelPlanner: 'ag000007',
  hotelLlm: 'ag000008',
  pricingAgent: 'ag000009',
  pricingLlm: 'ag000010',
  summaryTool: 'ag000011',
  plain: 'ag000012',
} as const;

export const AGENT_DESCRIPTIONS = {
  coordinator: 'Routes the request to specialist agents',
  flightPlanner: 'Finds and compares flights',
} as const;

export const PRICING_AGENT_NAME = 'availability_and_pricing_specialist';

// Long enough to need many more lines than the detail header shows at any pane width.
export const LONG_AGENT_DESCRIPTION = Array.from(
  { length: 30 },
  (_, i) => `Rule ${i + 1}: compare the quoted price with the last known rate, and report the difference per night.`
).join(' ');

export const AGENT_SEARCH_RESPONSE = {
  traces: [
    {
      traceID: AGENT_TRACE_ID,
      rootServiceName: 'multi-agent-service',
      rootTraceName: 'handle_request',
      startTimeUnixNano: t(0),
      durationMs: 3000,
      spanSets: [],
    },
  ],
};

const llmAttributes = (agentModel: string) => [
  str('gen_ai.operation.name', 'chat'),
  str('gen_ai.system', 'example-provider'),
  str('gen_ai.request.model', agentModel),
];

const toolAttributes = (toolName: string) => [
  str('gen_ai.operation.name', 'execute_tool'),
  str('gen_ai.tool.name', toolName),
];

const spans = [
  {
    spanId: AGENT_SPAN_IDS.root,
    parentSpanId: '',
    name: 'handle_request',
    start: 0,
    end: 3000,
    attributes: [str('openinference.span.kind', 'CHAIN')],
  },
  {
    // Name from gen_ai.agent.name, with a description.
    spanId: AGENT_SPAN_IDS.coordinator,
    parentSpanId: AGENT_SPAN_IDS.root,
    name: 'invoke_agent coordinator',
    start: 50,
    end: 2900,
    attributes: [
      str('gen_ai.operation.name', 'invoke_agent'),
      str('gen_ai.agent.name', 'coordinator'),
      str('gen_ai.agent.description', AGENT_DESCRIPTIONS.coordinator),
    ],
  },
  {
    spanId: AGENT_SPAN_IDS.coordinatorLlm,
    parentSpanId: AGENT_SPAN_IDS.coordinator,
    name: 'chat example-model-large',
    start: 100,
    end: 500,
    attributes: llmAttributes('example-model-large'),
  },
  {
    // Name from the agent.name attribute, with a description.
    spanId: AGENT_SPAN_IDS.flightPlanner,
    parentSpanId: AGENT_SPAN_IDS.coordinator,
    name: 'invoke_agent flight_planner_run',
    start: 550,
    end: 1400,
    attributes: [
      str('gen_ai.operation.name', 'invoke_agent'),
      str('agent.name', 'flight_planner'),
      str('gen_ai.agent.description', AGENT_DESCRIPTIONS.flightPlanner),
    ],
  },
  {
    spanId: AGENT_SPAN_IDS.flightLlm,
    parentSpanId: AGENT_SPAN_IDS.flightPlanner,
    name: 'chat example-model-small',
    start: 600,
    end: 900,
    attributes: llmAttributes('example-model-small'),
  },
  {
    spanId: AGENT_SPAN_IDS.flightTool,
    parentSpanId: AGENT_SPAN_IDS.flightPlanner,
    name: 'execute_tool search_flights',
    start: 920,
    end: 1300,
    attributes: toolAttributes('search_flights'),
  },
  {
    // Name only in the span name.
    spanId: AGENT_SPAN_IDS.hotelPlanner,
    parentSpanId: AGENT_SPAN_IDS.coordinator,
    name: 'invoke_agent hotel_planner',
    start: 1450,
    end: 2600,
    attributes: [str('gen_ai.operation.name', 'invoke_agent')],
  },
  {
    spanId: AGENT_SPAN_IDS.hotelLlm,
    parentSpanId: AGENT_SPAN_IDS.hotelPlanner,
    name: 'chat example-model-small',
    start: 1500,
    end: 1800,
    attributes: llmAttributes('example-model-small'),
  },
  {
    // A third level of handoff with a long name, for the narrow layouts.
    spanId: AGENT_SPAN_IDS.pricingAgent,
    parentSpanId: AGENT_SPAN_IDS.hotelPlanner,
    name: `invoke_agent ${PRICING_AGENT_NAME}`,
    start: 1850,
    end: 2550,
    attributes: [str('gen_ai.operation.name', 'invoke_agent'), str('gen_ai.agent.description', LONG_AGENT_DESCRIPTION)],
  },
  {
    spanId: AGENT_SPAN_IDS.pricingLlm,
    parentSpanId: AGENT_SPAN_IDS.pricingAgent,
    name: 'chat example-model-small',
    start: 1900,
    end: 2400,
    attributes: llmAttributes('example-model-small'),
  },
  {
    spanId: AGENT_SPAN_IDS.summaryTool,
    parentSpanId: AGENT_SPAN_IDS.coordinator,
    name: 'execute_tool format_itinerary',
    start: 2650,
    end: 2850,
    attributes: toolAttributes('format_itinerary'),
  },
  {
    // Outside every agent.
    spanId: AGENT_SPAN_IDS.plain,
    parentSpanId: AGENT_SPAN_IDS.root,
    name: 'write_audit_log',
    start: 2920,
    end: 2980,
    attributes: [str('http.route', '/audit')],
  },
];

export const AGENT_TRACE_RESPONSE = {
  resourceSpans: [
    {
      resource: { attributes: [str('service.name', 'multi-agent-service')] },
      scopeSpans: [
        {
          spans: spans.map(({ start, end, ...span }) => ({
            traceId: AGENT_TRACE_ID,
            ...span,
            startTimeUnixNano: t(start),
            endTimeUnixNano: t(end),
            events: [],
          })),
        },
      ],
    },
  ],
};

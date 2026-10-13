// Synthetic traces for large and deep trace tests. The generators are deterministic.

const BASE_NS = 1741900000000n * 1000000n;

export const LARGE_TRACE_ID = 'aa11bb22cc33dd44ee55ff6600778899';
export const CHAIN_TRACE_ID = 'bb11cc22dd33ee44ff55006611778899';

export const spanIdFor = (prefix: string, index: number): string => `${prefix}${index.toString(16).padStart(15, '0')}`;

type OtlpAttribute = { key: string; value: { stringValue?: string; intValue?: string } };

interface GeneratedSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string;
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpAttribute[];
  events: never[];
}

function searchResponseFor(traceId: string, rootName: string, durationMs: number) {
  return {
    traces: [{
      traceID: traceId,
      rootServiceName: 'synthetic-service',
      rootTraceName: rootName,
      startTimeUnixNano: String(BASE_NS),
      durationMs,
      spanSets: [],
    }],
  };
}

function wrap(spans: GeneratedSpan[]) {
  return {
    resourceSpans: [{
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'synthetic-service' } }] },
      scopeSpans: [{ spans }],
    }],
  };
}

function llmAttributes(index: number): OtlpAttribute[] {
  return [
    { key: 'openinference.span.kind', value: { stringValue: 'LLM' } },
    { key: 'llm.model_name', value: { stringValue: 'claude-sonnet-4-5' } },
    { key: 'llm.input_messages.0.message.role', value: { stringValue: 'user' } },
    { key: 'llm.input_messages.0.message.content', value: { stringValue: `question ${index}` } },
    { key: 'llm.output_messages.0.message.role', value: { stringValue: 'assistant' } },
    { key: 'llm.output_messages.0.message.content', value: { stringValue: `answer ${index}` } },
    { key: 'llm.token_count.total', value: { intValue: '100' } },
  ];
}

/**
 * One root with `spanCount` spans in total. Most spans form short branches, and every 3000th span starts a
 * dive that descends `maxDepth` levels, so the depth ranges from 1 to `maxDepth`.
 * Spans are numbered in display order. By default span 3 and every 500th span are LLM spans, so the detail
 * pane opens as soon as the trace loads; `llmIndexes` replaces that list.
 */
export function makeLargeTrace(spanCount: number, maxDepth: number, llmIndexes?: number[]) {
  const spans: GeneratedSpan[] = [];
  const path: string[] = [];
  let seed = 12345;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  let diveLeft = 0;

  for (let i = 0; i < spanCount; i++) {
    if (i > 0 && i % 3000 === 0) {
      diveLeft = maxDepth - path.length;
    }
    if (diveLeft > 0) {
      diveLeft--;
    } else if (i > 0) {
      const climb = random() < 0.05 ? 1 + Math.floor(random() * 40) : 1 + Math.floor(random() * 3);
      const stayDeep = random() < 0.5 && path.length < 12;
      path.length = Math.max(1, stayDeep ? path.length : path.length - climb);
    }
    const spanId = spanIdFor('lg', i);
    const parentSpanId = path.length > 0 ? path[path.length - 1] : '';
    const start = BASE_NS + BigInt(i) * 2000000n;
    const isLlm = llmIndexes ? llmIndexes.includes(i) : i === 3 || i % 500 === 0;
    const attributes = isLlm
      ? llmAttributes(i)
      : i % 7 === 0
        ? [{ key: 'openinference.span.kind', value: { stringValue: 'TOOL' } }]
        : [{ key: 'http.route', value: { stringValue: `/route/${i % 50}` } }];
    spans.push({
      traceId: LARGE_TRACE_ID,
      spanId,
      parentSpanId,
      name: isLlm ? `llm call ${i}` : `operation ${i}`,
      startTimeUnixNano: String(start),
      endTimeUnixNano: String(start + BigInt(5 + Math.floor(random() * 500)) * 1000000n),
      attributes,
      events: [],
    });
    path.push(spanId);
  }

  return {
    searchResponse: searchResponseFor(LARGE_TRACE_ID, 'operation 0', spanCount * 2),
    traceResponse: wrap(spans),
  };
}

/** A single chain: span 0 is the root and span i is the child of span i - 1. Span `depth` is an LLM span. */
export function makeChainTrace(depth: number) {
  const spans: GeneratedSpan[] = [];
  for (let i = 0; i <= depth; i++) {
    const start = BASE_NS + BigInt(i) * 1000000n;
    spans.push({
      traceId: CHAIN_TRACE_ID,
      spanId: spanIdFor('ch', i),
      parentSpanId: i === 0 ? '' : spanIdFor('ch', i - 1),
      name: i === depth ? `deepest llm call at level ${i}` : `chain step ${i}`,
      startTimeUnixNano: String(start),
      endTimeUnixNano: String(start + BigInt(depth + 10 - i) * 1000000n),
      attributes: i === depth ? llmAttributes(i) : [{ key: 'http.route', value: { stringValue: `/step/${i}` } }],
      events: [],
    });
  }
  return {
    searchResponse: searchResponseFor(CHAIN_TRACE_ID, 'chain step 0', depth + 10),
    traceResponse: wrap(spans),
  };
}

import type { DataSourceApi } from '@grafana/data';

// Broad filter that catches all supported LLM conventions:
//   - OpenInference: openinference.span.kind attribute present
//   - OTel GenAI / Vertex AI: gen_ai.system attribute present
//   - OTel GenAI operation: gen_ai.operation.name attribute present (set by opentelemetry-instrumentation-openai
//     and similar; may not set gen_ai.system when system is not yet known at instrumentation time)
//   - OpenInference fallback: llm.model_name attribute present
//   - GenAI request type: llm.request.type attribute present (Traceloop convention)
//
// The bare disjunction — used for standalone queries so the Prism TraceQL grammar
// can tokenize attribute names correctly (its filter pattern requires the first char
// inside {} to be an attribute name, not a parenthesis).
export const LLM_FILTER_CONDITIONS =
  'span.openinference.span.kind != "" || span.gen_ai.system != "" || span.gen_ai.operation.name != "" || span.llm.model_name != "" || span.llm.request.type != ""';

// BUG-040: grouped form, used only when &&-ing with a user condition so operator
// precedence is correct: (A||B||C||D||E) && user_condition
export const LLM_FILTER = `(${LLM_FILTER_CONDITIONS})`;

// Start with no pre-populated filters so all conventions appear by default.
// Users can add filters in the Search tab to narrow results.
export const DEFAULT_FILTERS: TempoLikeQuery['filters'] = [];

// Minimal shape of a Tempo query — enough to drive the QueryEditor + TraceQL generation.
// We avoid importing from Grafana internals.
export interface TempoLikeQuery {
  refId: string;
  queryType?: string;
  query?: string; // traceql mode
  limit?: number;
  spss?: number;
  filters?: Array<{
    id: string;
    tag?: string;
    operator?: string;
    value?: string | string[];
    scope?: string;
    type?: string;
  }>;
  [key: string]: unknown;
}

/** Returns true if the string looks like a bare trace ID (exactly 16 or 32 hex chars). */
export function looksLikeTraceId(s: string): boolean {
  return /^([0-9a-f]{16}|[0-9a-f]{32})$/i.test(s.trim());
}

export type TempoFilter = NonNullable<TempoLikeQuery['filters']>[0];

/** Convert a single Tempo search filter to a TraceQL condition. */
export function filterToCondition(f: TempoFilter): string | null {
  if (!f.tag) { return null; }
  const op = f.operator || '=';
  const prefix = (f.tag === 'name' || f.tag === 'status' || f.tag === 'duration' || f.tag === 'kind')
    ? ''
    : f.scope === 'resource' ? 'resource.'
    : f.scope === 'span' ? 'span.'
    : '';
  const attr = prefix + f.tag;

  // Normalise value to an array of raw strings, filtering out nulls/undefineds
  const rawVals: string[] = (Array.isArray(f.value) ? f.value : (f.value !== undefined ? [f.value] : []))
    .filter((v): v is string => v !== undefined && v !== null);

  // != with empty/missing value → "attribute exists" condition (e.g. span.kind != "")
  // The QueryEditor normalises value:[''] to value:[] so rawVals may be [] or [''] here.
  if (op === '!=' && (rawVals.length === 0 || rawVals.every((v) => v === ''))) {
    return `${attr}!=""`;
  }

  const nonEmpty = rawVals.filter((v) => v !== '');
  if (nonEmpty.length === 0) { return null; }

  // Escape backslashes and double quotes in attribute values (BUG-013)
  const escape = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  // Multiple values: emit an OR group
  if (nonEmpty.length > 1) {
    const conditions = nonEmpty.map((v) => `${attr}${op}"${escape(v)}"`);
    return `(${conditions.join(' || ')})`;
  }

  return `${attr}${op}"${escape(nonEmpty[0])}"`;
}

/**
 * Build a TraceQL query string from a TempoLikeQuery.
 * - TraceQL mode: use as-is and inject LLM filter
 * - Search mode with user filters: use user's filters directly (no LLM injection, to avoid conflicts)
 * - No filters: default to LLM filter
 */
export function tempoQueryToTraceQL(query: TempoLikeQuery, ds: DataSourceApi): string {
  // TraceQL mode: inject LLM filter around user's expression
  if (query.queryType === 'traceql' && query.query) {
    const base = query.query.trim();
    if (!base || base === '{}') {
      return `{${LLM_FILTER_CONDITIONS}}`;
    }
    if (base.includes(LLM_FILTER_CONDITIONS)) {
      return base; // already has our filter — don't inject again
    }
    return base.replace(/^\{/, `{${LLM_FILTER} && `);
  }

  // Search mode with filters: manual build first (predictable), then fall back to language provider
  if (query.filters && query.filters.length > 0) {
    // Our own filterToCondition is well-tested and handles empty-string != correctly.
    // Using it first avoids bugs in generateQueryFromFilters (e.g. it drops "" producing invalid TraceQL).
    const conditions = query.filters
      .map(filterToCondition)
      .filter((c): c is string => c !== null);
    if (conditions.length > 0) {
      return `{${conditions.join(' && ')}}`;
    }

    // No usable conditions from manual build — try the language provider for complex filter types
    try {
      const generated: string | undefined = (ds as any).languageProvider?.generateQueryFromFilters?.({ traceqlFilters: query.filters });
      if (generated && typeof generated === 'string' && generated !== '{}') {
        return generated;
      }
    } catch { /* fall through to default */ }
  }

  // Default: show all LLM spans
  return `{${LLM_FILTER_CONDITIONS}}`;
}

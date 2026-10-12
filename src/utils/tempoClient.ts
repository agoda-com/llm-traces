import { getBackendSrv } from '@grafana/runtime';
import type { KeyValuePair, SpanLog } from './llmUtils.ts';

export interface TempoTraceSearchResult {
  traceID: string;
  rootServiceName: string;
  rootTraceName: string;
  startTimeUnixNano: string;
  durationMs?: number;
  spanSets?: Array<{
    spans: Array<{
      spanID: string;
      startTimeUnixNano: string;
      durationNanos: string;
      name?: string;
      attributes: Array<{ key: string; value: { stringValue?: string; intValue?: string; doubleValue?: number; boolValue?: boolean } }>;
    }>;
    matched: number;
  }>;
}

export interface PluginSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  operationName: string;
  serviceName: string;
  serviceAttributes: KeyValuePair[];
  startTimeMs: number;
  durationMs: number;
  tags: KeyValuePair[];
  logs: SpanLog[];
  children: PluginSpan[];
  depth: number;
  // OTel span status — stored separately from attributes so it never pollutes the attribute table.
  // Populated from the OTLP status object OR from otel.status_code/otel.status_description attributes.
  statusCode?: 'OK' | 'ERROR' | 'UNSET';
  statusMessage?: string;
}

function parseOtlpValue(val: { stringValue?: string; intValue?: string; doubleValue?: number; boolValue?: boolean; arrayValue?: { values?: Array<{ stringValue?: string; intValue?: string; doubleValue?: number; boolValue?: boolean }> }; kvlistValue?: unknown }): unknown {
  if (val.stringValue !== undefined) {
    return val.stringValue;
  }
  if (val.intValue !== undefined) {
    return Number(val.intValue);
  }
  if (val.doubleValue !== undefined) {
    return val.doubleValue;
  }
  if (val.boolValue !== undefined) {
    return val.boolValue;
  }
  // BUG-036 fix: arrayValue returns ALL elements joined, not just the first.
  if (val.arrayValue?.values && val.arrayValue.values.length > 0) {
    const parts = val.arrayValue.values.map((item) => {
      if (item.stringValue !== undefined) { return String(item.stringValue); }
      if (item.intValue !== undefined) { return String(Number(item.intValue)); }
      if (item.doubleValue !== undefined) { return String(item.doubleValue); }
      if (item.boolValue !== undefined) { return String(item.boolValue); }
      return '';
    });
    return parts.join(', ');
  }
  // BUG-037 fix: handle kvlistValue — serialize as key=value pairs.
  if ((val as any).kvlistValue !== undefined) {
    const kv = (val as any).kvlistValue as { values?: Array<{ key: string; value: { stringValue?: string; intValue?: string; doubleValue?: number; boolValue?: boolean } }> };
    if (kv?.values && kv.values.length > 0) {
      return kv.values.map((entry) => {
        const v = parseOtlpValue(entry.value as Parameters<typeof parseOtlpValue>[0]);
        return `${entry.key}=${v}`;
      }).join(', ');
    }
    return '';
  }
  // BUG-049 fix: handle bytesValue — return base64 string or '(binary)'.
  if ((val as any).bytesValue !== undefined) {
    const bv = (val as any).bytesValue;
    return typeof bv === 'string' ? bv : '(binary)';
  }
  return '';
}

interface OtlpAttribute {
  key: string;
  value: { stringValue?: string; intValue?: string; doubleValue?: number; boolValue?: boolean; arrayValue?: { values?: Array<{ stringValue?: string; intValue?: string; doubleValue?: number; boolValue?: boolean }> }; kvlistValue?: unknown };
}

interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes?: OtlpAttribute[];
  events?: Array<{
    timeUnixNano: string;
    name: string;
    attributes?: OtlpAttribute[];
  }>;
  // OTel span status — separate from attributes in the OTLP wire format.
  // code: "STATUS_CODE_UNSET" | "STATUS_CODE_OK" | "STATUS_CODE_ERROR" (or numeric 0/1/2)
  status?: { code?: string | number; message?: string };
}

interface OtlpScopeSpan {
  spans: OtlpSpan[];
}

interface OtlpResourceSpan {
  resource?: { attributes?: OtlpAttribute[] };
  // new OTLP field name
  scopeSpans?: OtlpScopeSpan[];
  // old OTLP field name (pre-stable)
  instrumentationLibrarySpans?: OtlpScopeSpan[];
}

// Loose top-level shape — the actual response may be wrapped by Tempo or use
// the older "batches" field name, so we accept `unknown` at the call site and
// normalise inside parseOtlpTrace.
interface OtlpTrace {
  resourceSpans?: OtlpResourceSpan[];
  batches?: OtlpResourceSpan[];
  trace?: {
    resourceSpans?: OtlpResourceSpan[];
    batches?: OtlpResourceSpan[];
  };
}

function safeBigIntMs(nanoStr: string | undefined): number {
  if (!nanoStr) { return 0; }
  try {
    return Number(BigInt(nanoStr) / 1000000n);
  } catch {
    return 0;
  }
}

function parseOtlpTrace(data: unknown): PluginSpan[] {
  const flatSpans: PluginSpan[] = [];

  // Normalise the many possible top-level shapes into a single resourceSpans array.
  // Supported shapes:
  //   1. { resourceSpans: [...] }                — standard OTLP JSON
  //   2. { trace: { resourceSpans: [...] } }     — Tempo-wrapped format
  //   3. { batches: [...] }                      — old proto3 JSON format
  //   4. { trace: { batches: [...] } }           — old Tempo-wrapped format
  const d = data as OtlpTrace;
  const inner = d?.trace ?? d;
  const resourceSpans: OtlpResourceSpan[] = inner?.resourceSpans ?? inner?.batches ?? [];

  for (const rs of resourceSpans) {
    const serviceAttrs: KeyValuePair[] = (rs.resource?.attributes || []).map((a) => ({
      key: a.key,
      value: parseOtlpValue(a.value),
    }));
    const serviceName = serviceAttrs.find((a) => a.key === 'service.name')?.value as string || 'unknown';

    // Support both the current "scopeSpans" and the legacy "instrumentationLibrarySpans" field names.
    const scopeSpans: OtlpScopeSpan[] = rs.scopeSpans ?? rs.instrumentationLibrarySpans ?? [];

    for (const ss of scopeSpans) {
      for (const span of ss.spans || []) {
        const tags: KeyValuePair[] = (span.attributes || []).map((a) => ({
          key: a.key,
          value: parseOtlpValue(a.value),
        }));
        // Derive span status from the OTLP status object (preferred) or attribute fallback.
        // Stored as dedicated fields — never injected into tags — so the attribute table stays clean.
        let statusCode: PluginSpan['statusCode'];
        let statusMessage: string | undefined;
        if (span.status) {
          const code = String(span.status.code ?? '').toUpperCase();
          if (code === 'STATUS_CODE_ERROR' || code === 'ERROR' || code === '2') {
            statusCode = 'ERROR';
          } else if (code === 'STATUS_CODE_OK' || code === 'OK' || code === '1') {
            statusCode = 'OK';
          }
          // BUG-050 fix: only set statusMessage when statusCode is explicitly set (ERROR or OK).
          if (statusCode) {
            statusMessage = span.status.message || undefined;
          }
        }
        // Fallback: some SDKs set otel.status_code as a span attribute instead of / in addition to status field
        if (!statusCode) {
          const attrCode = tags.find((t) => t.key === 'otel.status_code');
          if (attrCode) {
            const v = String(attrCode.value).toUpperCase();
            if (v === 'ERROR') { statusCode = 'ERROR'; }
            else if (v === 'OK') { statusCode = 'OK'; }
          }
        }
        if (!statusMessage) {
          const attrMsg = tags.find((t) => t.key === 'otel.status_description');
          if (attrMsg) { statusMessage = String(attrMsg.value); }
        }
        const logs: SpanLog[] = (span.events || []).map((e) => ({
          timestamp: safeBigIntMs(e.timeUnixNano),
          name: e.name,
          fields: (e.attributes || []).map((a) => ({ key: a.key, value: parseOtlpValue(a.value) })),
        }));
        const startMs = safeBigIntMs(span.startTimeUnixNano);
        const endMs = safeBigIntMs(span.endTimeUnixNano);
        flatSpans.push({
          traceId: span.traceId,
          spanId: span.spanId,
          parentSpanId: span.parentSpanId || null,
          operationName: span.name,
          serviceName,
          serviceAttributes: serviceAttrs,
          startTimeMs: startMs,
          durationMs: Math.max(0, endMs - startMs),
          tags,
          logs,
          children: [],
          depth: 0,
          ...(statusCode ? { statusCode } : {}),
          ...(statusMessage ? { statusMessage } : {}),
        });
      }
    }
  }

  return buildTree(flatSpans);
}

function buildTree(spans: PluginSpan[]): PluginSpan[] {
  const byId = new Map<string, PluginSpan>();
  for (const s of spans) {
    byId.set(s.spanId, s);
  }
  const roots: PluginSpan[] = [];
  for (const s of spans) {
    // BUG-048 fix: guard against self-referencing spans (parentSpanId === spanId).
    if (s.parentSpanId && s.parentSpanId !== s.spanId && byId.has(s.parentSpanId)) {
      byId.get(s.parentSpanId)!.children.push(s);
    } else {
      // Mark spans that reference a non-existent parent as orphaned so the UI
      // can display a visual indicator for broken instrumentation.
      // BUG-039 fix: explicitly check non-empty string (defensive guard).
      if (s.parentSpanId && s.parentSpanId.trim() !== '' && s.parentSpanId !== s.spanId) {
        s.tags.push({ key: '_orphaned', value: true });
      }
      roots.push(s);
    }
  }
  assignDepth(roots, 0);
  sortByStartTime(roots);
  return roots;
}

function sortByStartTime(spans: PluginSpan[]): void {
  spans.sort((a, b) => a.startTimeMs - b.startTimeMs);
  // BUG-015 fix: recurse into ANY span with children, not just those with >1 child.
  for (const s of spans) {
    if (s.children.length > 0) {
      sortByStartTime(s.children);
    }
  }
}

function assignDepth(spans: PluginSpan[], depth: number) {
  for (const s of spans) {
    s.depth = depth;
    assignDepth(s.children, depth + 1);
  }
}

export function flattenTree(roots: PluginSpan[]): PluginSpan[] {
  const result: PluginSpan[] = [];
  function visit(span: PluginSpan) {
    result.push(span);
    for (const child of span.children) {
      visit(child);
    }
  }
  for (const root of roots) {
    visit(root);
  }
  return result;
}

export async function searchTraces(
  datasourceUid: string,
  query: string,
  start: number,
  end: number,
  limit = 20,
  spss = 3
): Promise<TempoTraceSearchResult[]> {
  const params: Record<string, string | number> = { limit, spss };
  if (query) {
    params.q = query;
  }
  if (start) {
    params.start = Math.floor(start / 1000);
  }
  if (end) {
    params.end = Math.floor(end / 1000);
  }
  const response = await getBackendSrv().get<{ traces?: TempoTraceSearchResult[] }>(
    `/api/datasources/proxy/uid/${datasourceUid}/api/search`,
    params
  );
  // BUG-062 fix: validate response for Tempo error bodies.
  const searchErrMsg = (response as any)?.error || (response as any)?.message;
  if (searchErrMsg && typeof searchErrMsg === 'string' && response?.traces === undefined) {
    throw new Error(searchErrMsg);
  }
  return response?.traces || [];
}

export async function fetchTrace(
  datasourceUid: string,
  traceId: string,
  start?: number,
  end?: number
): Promise<PluginSpan[]> {
  const params: Record<string, number> = {};
  if (start !== undefined) { params.start = Math.floor(start / 1000); }
  if (end !== undefined) { params.end = Math.floor(end / 1000); }
  const data = await getBackendSrv().get<unknown>(
    `/api/datasources/proxy/uid/${datasourceUid}/api/traces/${traceId}`,
    Object.keys(params).length ? params : undefined
  );
  // BUG-061 fix: validate response for Tempo error bodies like {"error": "trace not found"}.
  const errMsg = (data as any)?.error || (data as any)?.message;
  if (errMsg && typeof errMsg === 'string' && !((data as any)?.resourceSpans || (data as any)?.batches || (data as any)?.trace)) {
    throw new Error(errMsg);
  }
  return parseOtlpTrace(data);
}

export function getTraceDurationMs(spans: PluginSpan[]): number {
  const flat = flattenTree(spans);
  if (flat.length === 0) {
    return 0;
  }
  const minStart = flat.reduce((acc, s) => Math.min(acc, s.startTimeMs), Infinity);
  const maxEnd = flat.reduce((acc, s) => Math.max(acc, s.startTimeMs + s.durationMs), -Infinity);
  return Math.max(maxEnd - minStart, 1);
}

export function getTraceStartMs(spans: PluginSpan[]): number {
  const flat = flattenTree(spans);
  if (flat.length === 0) {
    return 0;
  }
  return flat.reduce((acc, s) => Math.min(acc, s.startTimeMs), Infinity);
}

export async function fetchTagValues(
  datasourceUid: string,
  tagName: string,
  start?: number,
  end?: number
): Promise<string[]> {
  const params: Record<string, number> = {};
  if (start) { params.start = Math.floor(start / 1000); }
  if (end) { params.end = Math.floor(end / 1000); }
  try {
    const data = await getBackendSrv().get<{ tagValues: Array<{ value: string }> }>(
      `/api/datasources/proxy/uid/${datasourceUid}/api/v2/search/tag/${encodeURIComponent(tagName)}/values`,
      Object.keys(params).length ? params : undefined
    );
    return (data?.tagValues || []).map((v) => v.value).filter(Boolean).sort();
  } catch (err) {
    // BUG-066 fix: log the error so developers can diagnose issues, then return [].
    console.warn('fetchTagValues error:', err);
    return [];
  }
}

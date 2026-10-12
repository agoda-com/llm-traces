import { useCallback, useMemo, useRef, useState } from 'react';
import { DataSourceApi, TimeRange } from '@grafana/data';
import { TempoTraceSearchResult, searchTraces } from '../utils/tempoClient';
import { TempoLikeQuery, tempoQueryToTraceQL } from '../utils/queryBuilder';

/** Extract a display name and service name from spanSets when rootTraceName/rootServiceName are blank. */
function extractNamesFromSpanSets(trace: TempoTraceSearchResult): { name: string; service: string } {
  const firstSpan = trace.spanSets?.[0]?.spans?.[0];
  if (!firstSpan) { return { name: trace.traceID, service: '' }; }
  const name = firstSpan.name || trace.traceID;
  const serviceAttr = firstSpan.attributes?.find(
    (a) => a.key === 'resource.service.name' || a.key === 'service.name'
  );
  const service = serviceAttr?.value?.stringValue || '';
  return { name, service };
}

interface UseTraceSearchParams {
  datasourceUid: string | null;
  dsRef: React.MutableRefObject<DataSourceApi | null>;
  timeRange: TimeRange;
  query: TempoLikeQuery;
  openTraceRef: React.MutableRefObject<((id: string, name?: string) => Promise<void>) | null>;
  updateTraceName: (traceId: string, traceName: string) => void;
  isMountedRef: React.MutableRefObject<boolean>;
  urlPreferredTraceRef: React.MutableRefObject<string | null>;
  /** Called at the start of each search to clear selected trace state */
  onSearchStart: () => void;
}

export interface UseTraceSearchResult {
  traces: TempoTraceSearchResult[];
  searchLoading: boolean;
  searchError: string | null;
  setSearchError: (error: string | null) => void;
  loadingMore: boolean;
  hasMoreTraces: boolean;
  errorsOnly: boolean;
  setErrorsOnly: (v: boolean | ((prev: boolean) => boolean)) => void;
  isDeepLinkedTraceOutsideResults: boolean;
  runSearch: (traceQL: string) => void;
  loadMoreTraces: () => void;
  searchRequestIdRef: React.MutableRefObject<number>;
  hasErrorTraces: boolean;
  displayedTraces: TempoTraceSearchResult[];
}

export function useTraceSearch({
  datasourceUid,
  dsRef,
  timeRange,
  query,
  openTraceRef,
  updateTraceName,
  isMountedRef,
  urlPreferredTraceRef,
  onSearchStart,
}: UseTraceSearchParams): UseTraceSearchResult {
  const [traces, setTraces] = useState<TempoTraceSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreTraces, setHasMoreTraces] = useState(true);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [isDeepLinkedTraceOutsideResults, setIsDeepLinkedTraceOutsideResults] = useState(false);
  const searchRequestIdRef = useRef(0);

  const runSearch = useCallback(async (traceQL: string) => {
    // BUG-063: guard before setSearchLoading(true) so a null datasource can't leave it stuck
    if (!datasourceUid) {
      setSearchLoading(false);
      return;
    }
    const preferredId = urlPreferredTraceRef.current;
    urlPreferredTraceRef.current = null;
    if (!preferredId) {
      onSearchStart();
    }
    setSearchLoading(true);
    setSearchError(null);
    setTraces([]);
    setHasMoreTraces(true);
    setIsDeepLinkedTraceOutsideResults(false);
    const requestId = ++searchRequestIdRef.current; // FIX-E: per-request ID for stale result discard
    try {
      const end = timeRange.to.valueOf();
      const start = timeRange.from.valueOf();
      const limit = query.limit ?? 20;
      const results = await searchTraces(datasourceUid, traceQL, start, end, limit, query.spss ?? 3);
      if (requestId !== searchRequestIdRef.current) { return; }
      if (!isMountedRef.current) { return; } // BUG-052
      results.sort((a, b) => Number(BigInt(b.startTimeUnixNano) - BigInt(a.startTimeUnixNano)));
      setTraces(results);
      setErrorsOnly(false);
      // A URL-preferred trace opens independently of search. Search only determines whether
      // it belongs to the visible result list; otherwise select the first result.
      if (preferredId) {
        const match = results.find((r) => r.traceID === preferredId);
        if (match) {
          const spanSetFallback = (!match.rootTraceName || !match.rootServiceName)
            ? extractNamesFromSpanSets(match) : null;
          const displayName = match.rootTraceName || spanSetFallback?.name || match.traceID;
          const displayService = match.rootServiceName || spanSetFallback?.service || '';
          updateTraceName(preferredId, displayService ? `${displayService} · ${displayName}` : displayName);
        }
        setIsDeepLinkedTraceOutsideResults(!match);
      } else if (results.length > 0) {
        const first = results[0];
        const spanSetFallback = (!first.rootTraceName || !first.rootServiceName)
          ? extractNamesFromSpanSets(first) : null;
        const displayName = first.rootTraceName || spanSetFallback?.name || first.traceID;
        const displayService = first.rootServiceName || spanSetFallback?.service || '';
        openTraceRef.current?.(first.traceID, displayService ? `${displayService} · ${displayName}` : displayName);
      }
    } catch (err) {
      if (requestId !== searchRequestIdRef.current) { return; }
      if (!isMountedRef.current) { return; } // BUG-052
      // Grafana BackendSrv throws { data: { message: '...' } } or standard Error objects
      const msg = (err as any)?.data?.message || (err instanceof Error ? err.message : null);
      setSearchError(msg || 'Search failed');
    } finally {
      if (requestId === searchRequestIdRef.current) {
        if (isMountedRef.current) { // BUG-052
          setSearchLoading(false);
        }
      }
    }
  }, [datasourceUid, timeRange, query.limit, query.spss, onSearchStart, openTraceRef, updateTraceName, isMountedRef, urlPreferredTraceRef]);

  const loadMoreTraces = useCallback(async () => {
    if (!datasourceUid || loadingMore || !hasMoreTraces || !dsRef.current) { return; }
    if (traces.length === 0) { return; }
    // Find the oldest trace by startTimeUnixNano and use it as the end boundary
    const oldest = traces.reduce((min, t) =>
      BigInt(t.startTimeUnixNano) < BigInt(min.startTimeUnixNano) ? t : min
    , traces[0]);
    // Subtract 1 second to make the boundary exclusive — ensures Tempo doesn't
    // return the oldest visible trace again (Tempo's end param has 1-second resolution).
    const endMs = Number(BigInt(oldest.startTimeUnixNano) / 1_000_000n) - 1000;
    const startMs = timeRange.from.valueOf();
    const traceQL = tempoQueryToTraceQL(query, dsRef.current);
    const limit = query.limit ?? 20;
    setLoadingMore(true);
    try {
      const results = await searchTraces(datasourceUid, traceQL, startMs, endMs, limit, query.spss ?? 3);
      if (!isMountedRef.current) { return; }
      if (results.length < limit) { setHasMoreTraces(false); }
      const existingIds = new Set(traces.map((t) => t.traceID));
      const newTraces = results.filter((t) => !existingIds.has(t.traceID));
      if (newTraces.length > 0) {
        setTraces((prev) => [...prev, ...newTraces].sort((a, b) =>
          Number(BigInt(b.startTimeUnixNano) - BigInt(a.startTimeUnixNano))
        ));
      } else {
        setHasMoreTraces(false);
      }
    } catch {
      // silently ignore load-more errors — the main search error state is unaffected
    } finally {
      if (isMountedRef.current) { setLoadingMore(false); }
    }
  }, [datasourceUid, traces, loadingMore, hasMoreTraces, timeRange, query, dsRef, isMountedRef]);

  // BUG-078: memoize these so they don't recompute on every render
  const hasErrorTraces = useMemo(
    () => traces.some((t) =>
      t.spanSets?.some((ss) =>
        ss.spans?.some((sp) =>
          sp.attributes?.some((a) => a.key === 'status' && String(a.value?.stringValue ?? '').toUpperCase() === 'ERROR')
        )
      )
    ),
    [traces]
  );

  const displayedTraces = useMemo(() => {
    const sorted = [...traces].sort((a, b) =>
      Number(BigInt(b.startTimeUnixNano) - BigInt(a.startTimeUnixNano))
    );
    return errorsOnly
      ? sorted.filter((t) =>
          t.spanSets?.some((ss) =>
            ss.spans?.some((sp) =>
              sp.attributes?.some((a) => a.key === 'status' && String(a.value?.stringValue ?? '').toUpperCase() === 'ERROR')
            )
          )
        )
      : sorted;
  }, [traces, errorsOnly]);

  return {
    traces,
    searchLoading,
    searchError,
    setSearchError,
    loadingMore,
    hasMoreTraces,
    errorsOnly,
    setErrorsOnly,
    isDeepLinkedTraceOutsideResults,
    runSearch,
    loadMoreTraces,
    searchRequestIdRef,
    hasErrorTraces,
    displayedTraces,
  };
}

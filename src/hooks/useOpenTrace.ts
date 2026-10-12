import { useCallback, useRef, useState } from 'react';
import { PluginSpan, fetchTrace } from '../utils/tempoClient';

export interface UseOpenTraceResult {
  selectedTraceId: string | null;
  selectedTraceName: string | null;
  traceSpans: PluginSpan[] | null;
  traceLoading: boolean;
  traceError: string | null;
  openTrace: (traceId: string, traceName?: string) => Promise<void>;
  openTraceRef: React.MutableRefObject<((id: string, name?: string) => Promise<void>) | null>;
  updateTraceName: (traceId: string, traceName: string) => void;
  /** Reset all trace state — call at the start of a new search to clear the detail pane */
  clearTrace: () => void;
}

export function useOpenTrace(
  datasourceUid: string | null,
  rangeStartMs: number,
  rangeEndMs: number,
  isMountedRef: React.MutableRefObject<boolean>
): UseOpenTraceResult {
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [selectedTraceName, setSelectedTraceName] = useState<string | null>(null);
  const [traceSpans, setTraceSpans] = useState<PluginSpan[] | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceError, setTraceError] = useState<string | null>(null);
  const selectedTraceIdRef = useRef<string | null>(null);
  const openTraceRequestIdRef = useRef(0);
  const openTraceRef = useRef<((id: string, name?: string) => Promise<void>) | null>(null);

  const clearTrace = useCallback(() => {
    selectedTraceIdRef.current = null;
    setSelectedTraceId(null);
    setSelectedTraceName(null);
    setTraceSpans(null);
    setTraceError(null);
  }, []);

  const openTrace = useCallback(async (traceId: string, traceName?: string) => {
    selectedTraceIdRef.current = traceId;
    setSelectedTraceId(traceId);
    setSelectedTraceName(traceName || traceId);
    setTraceSpans(null);
    setTraceError(null);
    // BUG-064: guard before setTraceLoading(true) so a null datasource can't leave it stuck
    if (!datasourceUid) {
      setTraceLoading(false);
      return;
    }
    setTraceLoading(true);
    const requestId = ++openTraceRequestIdRef.current;
    try {
      let spans: PluginSpan[];
      try {
        spans = await fetchTrace(datasourceUid, traceId, rangeStartMs, rangeEndMs);
      } catch (err) {
        const responseError = err as {
          status?: number;
          statusCode?: number;
          data?: { status?: number; statusCode?: number };
        };
        const status = responseError?.status ?? responseError?.statusCode ??
          responseError?.data?.status ?? responseError?.data?.statusCode;
        if (status !== 404) {
          throw err;
        }
        spans = await fetchTrace(datasourceUid, traceId);
      }
      if (requestId !== openTraceRequestIdRef.current) { return; }
      if (!isMountedRef.current) { return; } // BUG-052
      setTraceSpans(spans);
    } catch (err) {
      if (requestId !== openTraceRequestIdRef.current) { return; }
      if (!isMountedRef.current) { return; } // BUG-052
      // BUG-065: handle Grafana's { data: { message } } error shape in addition to Error objects
      setTraceError((err as any)?.data?.message ?? (err as any)?.message ?? 'Failed to load trace');
    } finally {
      if (requestId === openTraceRequestIdRef.current) {
        if (isMountedRef.current) { // BUG-052
          setTraceLoading(false);
        }
      }
    }
  }, [datasourceUid, rangeStartMs, rangeEndMs, isMountedRef]);

  const updateTraceName = useCallback((traceId: string, traceName: string) => {
    if (selectedTraceIdRef.current === traceId) {
      setSelectedTraceName(traceName);
    }
  }, []);

  // Keep the ref current so runSearch can call the latest openTrace
  openTraceRef.current = openTrace;

  return { selectedTraceId, selectedTraceName, traceSpans, traceLoading, traceError, openTrace, openTraceRef, updateTraceName, clearTrace };
}

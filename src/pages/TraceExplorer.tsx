import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useResize } from '../utils/useResize';

import { dateTime, dateMath, TimeRange } from '@grafana/data';
import { locationService } from '@grafana/runtime';
import { useStyles2, useTheme2, Button, ClipboardButton, Select, Alert, Icon, LoadingPlaceholder, TimeRangePicker } from '@grafana/ui';

import { TraceDetailView } from '../components/TraceDetail';
import { TRACE_DETAIL_MIN_WIDTH } from '../components/TraceDetail.styles';
import { TraceSummaryBar } from '../components/TraceSummaryBar';
import { getStyles } from './TraceExplorer.styles';
import {
  LLM_FILTER_CONDITIONS,
  LLM_FILTER,
  TempoLikeQuery,
  looksLikeTraceId,
  tempoQueryToTraceQL,
} from '../utils/queryBuilder';
import { formatDuration, formatTime } from '../utils/formatUtils';
import { useDatasource } from '../hooks/useDatasource';
import { useOpenTrace } from '../hooks/useOpenTrace';
import { useTraceSearch } from '../hooks/useTraceSearch';

// URL param keys — namespaced to avoid conflicts with Grafana's own params
const URL_DS_KEY = 'llt-ds';
const URL_FROM_KEY = 'llt-from';
const URL_TO_KEY = 'llt-to';
const URL_QUERY_KEY = 'llt-query';
const URL_TRACE_KEY = 'llt-traceId';

function defaultTimeRange(): TimeRange {
  const now = dateTime();
  return { from: dateTime(now).subtract(3, 'hours'), to: now, raw: { from: 'now-3h', to: 'now' } };
}

function timeRangeFromRaw(from: string, to: string): TimeRange {
  // BUG-041: dateMath.parse can return an invalid moment; fall back to dateTime() and then
  // to the default range if both produce an invalid value.
  const parsedFrom = dateMath.parse(from) ?? dateTime(from);
  const parsedTo = dateMath.parse(to, true) ?? dateTime(to);
  const fromDt = parsedFrom?.isValid() ? parsedFrom : defaultTimeRange().from;
  const toDt = parsedTo?.isValid() ? parsedTo : defaultTimeRange().to;
  return { from: fromDt, to: toDt, raw: { from, to } };
}

export function TraceExplorer() {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();

  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);
  const [traceListCollapsed, setTraceListCollapsed] = useState(
    () => Boolean(locationService.getSearchObject()[URL_TRACE_KEY])
  );
  const { width: traceListWidth, onMouseDown: onTraceListResize } = useResize(380, 160, 700);

  const [timeRange, setTimeRange] = useState<TimeRange>(() => {
    const p = locationService.getSearchObject();
    const from = p[URL_FROM_KEY] as string | undefined;
    const to = p[URL_TO_KEY] as string | undefined;
    if (from && to) { return timeRangeFromRaw(from, to); }
    return defaultTimeRange();
  });

  const [query, setQuery] = useState<TempoLikeQuery>(() => {
    const urlQueryStr = locationService.getSearchObject()[URL_QUERY_KEY];
    if (urlQueryStr) {
      try { return JSON.parse(String(urlQueryStr)); } catch { /* fall through */ }
    }
    return { refId: 'A', queryType: 'traceql', query: `{${LLM_FILTER_CONDITIONS}}` };
  });

  // BUG-052: isMounted ref to prevent setState after unmount
  const isMountedRef = useRef(true);
  const didInitRef = useRef(false);
  const firstDsLoadRef = useRef(true);
  // Tracks whether the user has made a real change in the QueryEditor
  const didMountTimeRangeRef = useRef(false);
  // When a llt-traceId URL param is present, store it here so search can determine whether
  // the directly opened trace belongs to the visible result list.
  const urlPreferredTraceRef = useRef<string | null>(null);
  // URL params read once at mount
  const urlParamsRef = useRef<{ datasourceUid?: string; traceId?: string } | null>(null);
  if (!urlParamsRef.current) {
    const p = locationService.getSearchObject();
    urlParamsRef.current = {
      datasourceUid: p[URL_DS_KEY] ? String(p[URL_DS_KEY]) : undefined,
      traceId: p[URL_TRACE_KEY] ? String(p[URL_TRACE_KEY]) : undefined,
    };
  }

  const toolbarRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // BUG-052: mark component as unmounted so async callbacks don't call setState after unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // Datasource management
  const { datasourceUid, setDatasourceUid, datasourceOptions, ds, dsRef, dsLoadError, QueryEditorComponent, queryEditorDirtyRef } =
    useDatasource(urlParamsRef.current?.datasourceUid);

  // Trace detail management
  const { selectedTraceId, selectedTraceName, traceSpans, traceLoading, traceError, openTrace, openTraceRef, updateTraceName, clearTrace } =
    useOpenTrace(datasourceUid, timeRange.from.valueOf(), timeRange.to.valueOf(), isMountedRef);

  // Search management
  const {
    traces,
    searchLoading,
    searchError,
    setSearchError,
    loadingMore,
    hasMoreTraces,
    errorsOnly,
    setErrorsOnly,
    runSearch,
    loadMoreTraces,
    searchRequestIdRef,
    hasErrorTraces,
    displayedTraces,
  } = useTraceSearch({
    datasourceUid,
    dsRef,
    timeRange,
    query,
    openTraceRef,
    updateTraceName,
    isMountedRef,
    urlPreferredTraceRef,
    onSearchStart: clearTrace,
  });

  // Coordination: reset state when datasource changes
  useEffect(() => {
    if (!datasourceUid) { return; }
    // BUG-051/053: invalidate any in-flight search requests from the previous datasource
    searchRequestIdRef.current++;
    if (firstDsLoadRef.current) {
      firstDsLoadRef.current = false;
    } else {
      setQuery({ refId: 'A', queryType: 'traceql', query: `{${LLM_FILTER}}` });
    }
    didInitRef.current = false; // FIX-D: reset so initial search fires on datasource switch
  }, [datasourceUid]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRunQuery = useCallback(() => {
    if (!dsRef.current) { return; }
    // If the user typed a bare trace ID, jump directly to that trace
    if (query.queryType === 'traceql' && query.query && looksLikeTraceId(query.query)) {
      openTrace(query.query.trim());
      return;
    }
    const traceQL = tempoQueryToTraceQL(query, dsRef.current);
    runSearch(traceQL);
  }, [query, runSearch, openTrace, dsRef]);

  // Initial search once datasource is loaded
  useEffect(() => {
    if (ds && !didInitRef.current) {
      didInitRef.current = true;
      const urlTraceId = urlParamsRef.current?.traceId;
      if (urlTraceId) {
        urlPreferredTraceRef.current = urlTraceId;
        void openTrace(urlTraceId).then(() => {
          if (isMountedRef.current) {
            handleRunQuery();
          }
        });
      } else {
        handleRunQuery();
      }
    }
  }, [ds, handleRunQuery, openTrace]);

  // Re-run search when time range changes (skip initial mount)
  useEffect(() => {
    if (!didMountTimeRangeRef.current) { didMountTimeRangeRef.current = true; return; }
    if (dsRef.current) { handleRunQuery(); }
  }, [timeRange]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync current state to URL so the page is always shareable
  useEffect(() => {
    const from = typeof timeRange.raw.from === 'string' ? timeRange.raw.from : timeRange.raw.from.toISOString();
    const to = typeof timeRange.raw.to === 'string' ? timeRange.raw.to : timeRange.raw.to.toISOString();
    locationService.partial(
      {
        [URL_DS_KEY]: datasourceUid ?? null,
        [URL_FROM_KEY]: from,
        [URL_TO_KEY]: to,
        [URL_QUERY_KEY]: JSON.stringify(query),
        [URL_TRACE_KEY]: selectedTraceId ?? null,
      },
      true // replace history entry rather than push
    );
  }, [datasourceUid, timeRange, query, selectedTraceId]);

  // BUG-059: scroll the selected trace item into view after the list renders
  useEffect(() => {
    if (selectedTraceId) {
      document.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedTraceId, traces]);

  // Body height = viewport height minus whatever fixed chrome sits above the plugin
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const toolbar = toolbarRef.current;
    if (!body || !toolbar) { return; }
    const update = () => {
      const toolbarH = toolbar.getBoundingClientRect().height;
      const bodyDocTop = body.getBoundingClientRect().top + window.scrollY;
      const fixedNavH = Math.max(0, bodyDocTop - toolbarH);
      body.style.height = `${window.innerHeight - fixedNavH}px`;
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [toolbarCollapsed]);

  // Prevent page scroll chaining when a column is at its boundary
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) { return; }

    const handleWheel = (e: WheelEvent) => {
      const px = e.deltaMode === 1 ? e.deltaY * 40
               : e.deltaMode === 2 ? e.deltaY * window.innerHeight
               : e.deltaY;

      let el = e.target as HTMLElement | null;
      while (el && el !== body) {
        const style = window.getComputedStyle(el);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
          const atTop    = el.scrollTop <= 0;
          const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
          const maxPageScroll = document.documentElement.scrollHeight - window.innerHeight;
          const toolbarVisible = window.scrollY < maxPageScroll - 1;

          if (px < 0 && atTop) {
            e.preventDefault();
            window.scrollBy(0, px);
          } else if (px > 0 && toolbarVisible) {
            e.preventDefault();
            window.scrollBy(0, px);
          } else if (px > 0 && atBottom) {
            e.preventDefault();
          }
          return;
        }
        el = el.parentElement;
      }
    };

    body.addEventListener('wheel', handleWheel, { passive: false });
    return () => body.removeEventListener('wheel', handleWheel);
  }, []);

  // Hide Service Graph tab and Import trace button injected by the Tempo QueryEditor
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) { return; }
    const applyHides = () => {
      el.querySelectorAll<HTMLElement>('[data-testid="RadioButton.container"]').forEach((container) => {
        const labelText = container.querySelector('label')?.textContent?.trim();
        if (
          container.querySelector('input[id^="option-serviceMap-"]') ||
          labelText === 'Service Graph'
        ) {
          container.style.display = 'none';
        }
      });
      el.querySelectorAll<HTMLElement>('label, span').forEach((node) => {
        if (node.childElementCount === 0 && node.textContent?.trim() === 'Service Graph') {
          let ancestor: HTMLElement | null = node.parentElement;
          while (ancestor && ancestor !== el) {
            if (
              ancestor.getAttribute('data-testid') === 'RadioButton.container' ||
              ancestor.getAttribute('role') === 'radio' ||
              ancestor.tagName === 'LABEL'
            ) {
              ancestor.style.display = 'none';
              break;
            }
            ancestor = ancestor.parentElement;
          }
          node.style.display = 'none';
        }
      });
      el.querySelectorAll<HTMLElement>('button').forEach((btn) => {
        if (btn.textContent?.trim() === 'Import trace') {
          btn.style.display = 'none';
        }
      });
      el.querySelectorAll<HTMLElement>('label, div, span').forEach((node) => {
        if (node.childElementCount === 0 && node.textContent?.trim() === 'Query type') {
          node.style.display = 'none';
        }
      });
    };
    applyHides();
    const observer = new MutationObserver(applyHides);
    observer.observe(el, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return (
    <div className={styles.root} data-testid="trace-explorer">
      <div className={styles.toolbar} ref={toolbarRef} data-testid="plugin-toolbar">
        {/* Top row: title, datasource, time range, search */}
        <div className={styles.toolbarTopRow}>
          <div className={styles.pageTitle}>
            <Icon name="ai-sparkle" />
            LLM Traces
          </div>
          <div className={styles.divider} />
          <div className={styles.dsSelect}>
            <Select
              options={datasourceOptions}
              value={datasourceUid ?? undefined}
              onChange={(v) => { if (!v?.value) { return; } setDatasourceUid(v.value); }}
              placeholder="Select datasource..."
            />
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: theme.spacing(1) }}>
          <div className={styles.timePickerWrap}>
            <TimeRangePicker
              value={timeRange}
              onChange={(range) => setTimeRange(range)}
              onChangeTimeZone={() => {}}
              onMoveBackward={() => {}}
              onMoveForward={() => {}}
              onZoom={() => {}}
            />
          </div>
          <Button onClick={handleRunQuery} disabled={searchLoading || !ds} icon="search">
            Search
          </Button>
          <ClipboardButton
            icon="share-alt"
            variant="secondary"
            getText={() => window.location.href}
            title="Copy share link"
          >
            Share
          </ClipboardButton>
          <button
            onClick={() => setToolbarCollapsed((c) => !c)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              borderRadius: '2px',
              color: 'inherit',
            }}
            title={toolbarCollapsed ? 'Expand toolbar' : 'Collapse toolbar'}
            aria-label={toolbarCollapsed ? 'Expand toolbar' : 'Collapse toolbar'}
          >
            <Icon name={toolbarCollapsed ? 'angle-down' : 'angle-up'} />
          </button>
          </div>
        </div>

        {/* Tempo QueryEditor — shows the native Search / TraceQL tabs */}
        {!toolbarCollapsed && dsLoadError && <div data-testid="ds-load-error"><Alert title={dsLoadError} severity="error" /></div>}
        {!toolbarCollapsed && !ds && !dsLoadError && <LoadingPlaceholder text="Loading Tempo datasource…" />}
        {!toolbarCollapsed && ds && QueryEditorComponent && (
          <div className={styles.queryEditorWrap}>
            <QueryEditorComponent
              datasource={ds}
              query={query}
              onChange={(q: TempoLikeQuery) => {
                // The Tempo QueryEditor calls onChange during mount to "normalize" the query.
                // Block ALL editor-initiated changes until after the initial search has fired
                // (didInitRef.current becomes true), then only allow real user edits.
                if (!queryEditorDirtyRef.current) {
                  if (!didInitRef.current) { return; }
                  const isEmptyReset = q.queryType === 'traceql' && (!q.query || q.query.trim() === '{}');
                  if (isEmptyReset) { return; }
                  queryEditorDirtyRef.current = true;
                }
                setQuery(q);
              }}
              onRunQuery={() => {/* search only via button, time range change, or page load */}}
              history={[]}
            />
          </div>
        )}
        {!toolbarCollapsed && ds && !QueryEditorComponent && (
          <Alert title="Tempo QueryEditor not available" severity="warning" />
        )}

      </div>

      <div ref={bodyRef} className={styles.body}>
        {!traceListCollapsed && <div
          className={styles.traceList}
          data-testid="trace-list-pane"
          style={{ width: traceListWidth }}
          role="listbox"
          aria-label="Traces"
          tabIndex={0}
          aria-activedescendant={selectedTraceId ? `trace-option-${selectedTraceId}` : undefined}
          onKeyDown={(e) => {
            // BUG-044: keyboard navigation within the listbox
            if (!displayedTraces.length) { return; }
            const currentIndex = selectedTraceId ? displayedTraces.findIndex((t) => t.traceID === selectedTraceId) : -1;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              const next = displayedTraces[Math.min(currentIndex + 1, displayedTraces.length - 1)];
              if (next) { openTrace(next.traceID, next.rootTraceName || next.traceID); }
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              const prev = displayedTraces[Math.max(currentIndex - 1, 0)];
              if (prev) { openTrace(prev.traceID, prev.rootTraceName || prev.traceID); }
            }
          }}
          onScroll={(e) => {
            const el = e.currentTarget;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
              loadMoreTraces();
            }
          }}
        >
          <>

          <div className={styles.traceListHeader} style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ flex: 1 }}>{searchLoading ? 'Searching…' : `${displayedTraces.length}${errorsOnly ? ` / ${traces.length}` : ''} trace${displayedTraces.length !== 1 ? 's' : ''}`}</span>
            {hasErrorTraces && (
              <button
                onClick={() => setErrorsOnly((v) => !v)}
                title={errorsOnly ? 'Show all traces' : 'Show only error traces'}
                aria-pressed={errorsOnly}
                style={{
                  background: errorsOnly ? theme.colors.error.transparent : 'none',
                  border: `1px solid ${errorsOnly ? theme.colors.error.border : theme.colors.border.weak}`,
                  borderRadius: '3px',
                  cursor: 'pointer',
                  color: errorsOnly ? theme.colors.error.text : theme.colors.text.secondary,
                  fontSize: '10px',
                  padding: '1px 6px',
                  marginRight: theme.spacing(0.5),
                }}
              >
                ⚠ Errors
              </button>
            )}
            <button
              onClick={() => setTraceListCollapsed(true)}
              title="Collapse trace list"
              aria-label="Collapse trace list"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'flex', alignItems: 'center', padding: '0 2px' }}
            >
              <Icon name="angle-left" size="sm" />
            </button>
          </div>
          <TraceSummaryBar traces={traces} />
          {searchLoading && Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={styles.skeletonItem}>
              <div className={styles.skeletonLine} style={{ height: '13px', width: `${55 + (i * 17) % 35}%`, marginBottom: '6px' }} />
              <div style={{ display: 'flex', gap: '8px' }}>
                <div className={styles.skeletonLine} style={{ height: '11px', width: '18%' }} />
                <div className={styles.skeletonLine} style={{ height: '11px', width: '10%' }} />
                <div className={styles.skeletonLine} style={{ height: '11px', width: '22%' }} />
              </div>
            </div>
          ))}
          {searchError && !searchLoading && (
            <div
              data-testid="search-error-message"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: theme.spacing(0.75),
                padding: `${theme.spacing(0.75)} ${theme.spacing(1.5)}`,
                color: theme.colors.error.text,
                fontSize: theme.typography.bodySmall.fontSize,
              }}
            >
              <Icon name="exclamation-circle" size="sm" style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {searchError}
              </span>
              <button
                onClick={() => setSearchError(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, display: 'flex', flexShrink: 0 }}
                title="Dismiss"
                aria-label="Dismiss error"
              >
                <Icon name="times" size="sm" />
              </button>
            </div>
          )}
          {!searchLoading && displayedTraces.length === 0 && !searchError && (
            <div className={styles.empty} style={{ height: '200px' }}>
              <span>{errorsOnly ? 'No error traces' : 'No traces found'}</span>
            </div>
          )}
          {displayedTraces.map((trace) => {
            const hasError = trace.spanSets?.some((ss) =>
              ss.spans?.some((sp) =>
                sp.attributes?.some((a) => a.key === 'status' && String(a.value?.stringValue ?? '').toUpperCase() === 'ERROR')
              )
            ) ?? false;
            const displayName = trace.rootTraceName || trace.traceID;
            const displayService = trace.rootServiceName || '';
            return (
              <div
                key={trace.traceID}
                id={`trace-option-${trace.traceID}`}
                className={`${styles.traceItem} ${trace.traceID === selectedTraceId ? styles.traceItemSelected : ''}`}
                onClick={() => openTrace(trace.traceID, `${displayService} · ${displayName}`)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && openTrace(trace.traceID, `${displayService} · ${displayName}`)}
                role="option"
                tabIndex={0}
                aria-selected={trace.traceID === selectedTraceId}
                data-testid={`trace-item-${trace.traceID}`}
              >
                <div className={styles.traceName} style={{ display: 'flex', alignItems: 'center', gap: theme.spacing(0.5) }}>
                  {hasError && (
                    <span
                      title="Contains error spans"
                      style={{ color: theme.colors.error.text, fontSize: '10px', flexShrink: 0 }}
                    >
                      ⚠
                    </span>
                  )}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {displayName}
                  </span>
                </div>
                <div className={styles.traceMeta}>
                  <span className={styles.traceService}>{displayService}</span>
                  <span style={{ flexShrink: 0 }}>{formatDuration(trace.durationMs)}</span>
                  <span>{formatTime(trace.startTimeUnixNano)}</span>
                  <button
                    className={`${styles.copyBtn} copy-btn`}
                    title="Copy trace ID"
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigator.clipboard.writeText(trace.traceID).catch(() => {});
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.stopPropagation();
                        navigator.clipboard.writeText(trace.traceID).catch(() => {});
                      }
                    }}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                  >
                    <Icon name="copy" size="sm" />
                  </button>
                </div>
              </div>
            );
          })}
          {loadingMore && (
            <div style={{ padding: `${theme.spacing(1)} ${theme.spacing(1.5)}`, color: theme.colors.text.secondary, fontSize: theme.typography.bodySmall.fontSize }}>
              Loading more…
            </div>
          )}
          {!loadingMore && !hasMoreTraces && traces.length > 0 && (
            <div style={{ padding: `${theme.spacing(0.75)} ${theme.spacing(1.5)}`, color: theme.colors.text.disabled, fontSize: '11px', textAlign: 'center' }}>
              No more traces
            </div>
          )}
          </>
        </div>}

        {!traceListCollapsed && (
          <div
            className={styles.resizeHandle}
            data-testid="resize-handle-trace-list"
            onMouseDown={onTraceListResize}
          />
        )}

        {traceListCollapsed && (
          <button
            onClick={() => setTraceListCollapsed(false)}
            title="Expand trace list"
            aria-label="Expand trace list"
            style={{
              width: '20px',
              flexShrink: 0,
              background: 'none',
              border: 'none',
              borderRight: `1px solid ${theme.colors.border.weak}`,
              cursor: 'pointer',
              color: 'inherit',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
            }}
          >
            <Icon name="angle-right" size="sm" />
          </button>
        )}

        <div className={styles.detailArea} style={{ minWidth: selectedTraceId ? TRACE_DETAIL_MIN_WIDTH : 0 }}>
          {selectedTraceId ? (
            <TraceDetailView
              traceId={selectedTraceId}
              rootName={selectedTraceName || undefined}
              spans={traceSpans}
              loading={traceLoading}
              error={traceError || undefined}
              onBack={() => { clearTrace(); }}
            />
          ) : (
            <div className={styles.empty}>
              <Icon name="ai-sparkle" size="xxl" />
              <div className={styles.emptyTitle}>LLM Trace Explorer</div>
              <div className={styles.emptySubtitle}>
                Filter by service, span name, or paste a trace ID to jump directly to a trace.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

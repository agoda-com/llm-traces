import React, { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';

import { useResize } from '../utils/useResize';

import { useStyles2, useTheme2, Alert, Icon } from '@grafana/ui';
import { getStyles, SPAN_DETAIL_RESERVED_WIDTH, SPAN_LIST_MIN_WIDTH } from './TraceDetail.styles';

import { PluginSpan, flattenTree, getTraceDurationMs, getTraceStartMs } from '../utils/tempoClient';
import { isLlmSpan, isGuardrailSpan, isAiSpan, extractLlmSpanData } from '../utils/llmUtils';
import { estimateCost, formatCost } from '../utils/costUtils';
import { formatDuration } from '../utils/formatUtils';
import { scrollWithinContainer } from '../utils/scrollUtils';
import { SpanRow } from './SpanRow';
import { SpanDetailPanel } from './SpanDetailPanel';

/** Recursively collect spanIds that have children (for collapse-all). Leaf spans are skipped. */
function getAllSpanIds(spans: PluginSpan[]): string[] {
  const ids: string[] = [];
  const visit = (s: PluginSpan) => {
    if (s.children.length > 0) {
      ids.push(s.spanId);
      s.children.forEach(visit);
    }
  };
  spans.forEach(visit);
  return ids;
}

interface TraceDetailViewProps {
  traceId: string;
  rootName?: string;
  spans: PluginSpan[] | null;
  loading: boolean;
  error?: string;
  onBack: () => void;
  /** BUG-072: increment this when re-opening the same trace to force state reset */
  openCount?: number;
}

export function TraceDetailView({ traceId, rootName, spans, loading, error, onBack, openCount = 0 }: TraceDetailViewProps) {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [aiOnly, setAiOnly] = useState(false);
  const [spanFilter, setSpanFilter] = useState('');
  const [detailPaneOpen, setDetailPaneOpen] = useState(true);
  const [listPaneOpen, setListPaneOpen] = useState(true);
  // BUG-077: flag set by Escape to prevent auto-re-selection via firstLlmSpan
  const [userDismissedDetail, setUserDismissedDetail] = useState(false);
  const { width: spanListWidth, onMouseDown: onSpanListResize } = useResize(500, SPAN_LIST_MIN_WIDTH, 900);
  const displayedSpansRef = useRef<PluginSpan[]>([]);
  const effectiveSelectedRef = useRef<string | null>(null);

  // Reset span selection and filter state when a new trace is opened
  // BUG-072: openCount (from parent) triggers reset when same traceId is reopened
  useEffect(() => {
    setSelectedSpanId(null);
    setCollapsed(new Set());
    setAiOnly(false);
    setSpanFilter('');
    setUserDismissedDetail(false);
  }, [traceId, openCount]);

  const handleToggleExpand = useCallback((spanId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(spanId)) {
        next.delete(spanId);
      } else {
        next.add(spanId);
      }
      return next;
    });
  }, []);

  const handleCollapseAll = useCallback(() => {
    if (!spans) { return; }
    // BUG-058: clear text filter when collapsing all to avoid silently hiding matching spans
    setSpanFilter('');
    // BUG-023: when AI-only mode is active, skip collapsing direct parents of AI spans
    if (aiOnly) {
      const flatAll = flattenTree(spans);
      const aiSpanParentIds = new Set<string>(
        flatAll
          .filter((s) => isAiSpan(s.tags) && s.parentSpanId)
          .map((s) => s.parentSpanId!)
      );
      const allParentIds = getAllSpanIds(spans);
      setCollapsed(new Set(allParentIds.filter((id) => !aiSpanParentIds.has(id))));
    } else {
      setCollapsed(new Set(getAllSpanIds(spans)));
    }
  }, [spans, aiOnly]);

  const handleExpandAll = useCallback(() => {
    setCollapsed(new Set());
  }, []);

  const handleSelectSpan = useCallback((span: PluginSpan) => {
    setUserDismissedDetail(false);
    setSelectedSpanId(span.spanId);
  }, []);

  // Scroll selected span into view when selection changes
  useEffect(() => {
    if (!selectedSpanId) { return; }
    const container = containerRef.current;
    const el = (container ?? document).querySelector(`[data-testid="span-row-${selectedSpanId}"]`);
    const pane = el?.closest('[data-testid="span-list-pane"]');
    if (el && pane) { scrollWithinContainer(el, pane, 'smooth'); }
  }, [selectedSpanId]);

  const flatSpans = useMemo(() => spans ? flattenTree(spans) : [], [spans]);

  // Derive trace display name from the root span (no parent) when the prop-passed rootName is blank.
  // Note: Tempo may return "<root span not yet received>" as rootTraceName — this is normal and
  // should display as-is; the derived name from span data is only used when rootName is absent.
  const derivedRootName = useMemo(() => {
    if (rootName) { return rootName; }
    if (!flatSpans.length) { return undefined; }
    const rootSpan = flatSpans.find((s) => !s.parentSpanId) ?? flatSpans[0];
    const service = (rootSpan.serviceName ||
      rootSpan.serviceAttributes?.find((a) => a.key === 'service.name')?.value as string | undefined) || '';
    const name = rootSpan.operationName || '';
    if (service && name) { return `${service} · ${name}`; }
    return name || service || undefined;
  }, [rootName, flatSpans]);

  const traceDurationMs = useMemo(() => spans ? getTraceDurationMs(spans) : 0, [spans]);
  const traceStartMs = useMemo(() => spans ? getTraceStartMs(spans) : 0, [spans]);
  const llmSpanCount = useMemo(() => flatSpans.filter((s) => isLlmSpan(s.tags)).length, [flatSpans]);

  const { totalTokens, totalCostUsd, costIsMixed, costIsPartial } = useMemo(() => {
    let tokens = 0;
    let costUsd = 0;
    let precomputedCount = 0;
    let estimatedCount = 0;
    let skippedLlmSpans = 0;
    flatSpans.forEach((span) => {
      const llmData = extractLlmSpanData(span.tags, span.logs, span.operationName);
      if (llmData.isLlm && llmData.tokenUsage.total != null) {
        tokens += llmData.tokenUsage.total;
      }
      if (llmData.isLlm) {
        if (llmData.precomputedCostUsd !== undefined) {
          costUsd += llmData.precomputedCostUsd;
          precomputedCount++;
        } else if (llmData.model && llmData.tokenUsage.input != null) {
          const cost = estimateCost(llmData.model, llmData.tokenUsage.input, llmData.tokenUsage.output);
          if (cost !== undefined) {
            costUsd += cost;
            estimatedCount++;
          } else {
            skippedLlmSpans++;
          }
        } else {
          skippedLlmSpans++;
        }
      }
    });
    const isMixed = precomputedCount > 0 && estimatedCount > 0;
    const isPartial = skippedLlmSpans > 0 && (precomputedCount + estimatedCount) > 0;
    return { totalTokens: tokens > 0 ? tokens : null, totalCostUsd: costUsd > 0 ? costUsd : null, costIsMixed: isMixed, costIsPartial: isPartial };
  }, [flatSpans]);

  // Build visible spans respecting collapse state
  const visibleSpans = useMemo(() => {
    const result: PluginSpan[] = [];
    const visitSpan = (span: PluginSpan) => {
      result.push(span);
      if (!collapsed.has(span.spanId)) {
        for (const child of span.children) { visitSpan(child); }
      }
    };
    if (spans) { for (const root of spans) { visitSpan(root); } }
    return result;
  }, [spans, collapsed]);

  const displayedSpans = useMemo(() => {
    let result = aiOnly ? visibleSpans.filter((span) => isAiSpan(span.tags)) : visibleSpans;
    const q = spanFilter.trim().toLowerCase();
    if (q) {
      result = result.filter((span) => {
        if (span.operationName.toLowerCase().includes(q)) { return true; }
        if (span.serviceName.toLowerCase().includes(q)) { return true; }
        return span.tags.some(
          (t) => t.key.toLowerCase().includes(q) || String(t.value).toLowerCase().includes(q)
        );
      });
    }
    return result;
  }, [visibleSpans, aiOnly, spanFilter]);

  displayedSpansRef.current = displayedSpans;

  // Derive effective selected span: if selectedSpanId is not in displayedSpans, treat as null
  const effectiveSelectedSpanId = displayedSpans.some((s) => s.spanId === selectedSpanId) ? selectedSpanId : null;

  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-focus the container on mount so keyboard navigation (j/k/ArrowUp/ArrowDown) works
  // immediately when a trace detail panel opens, without requiring a click inside the panel.
  // BUG-026: use useLayoutEffect so focus is set synchronously before the browser paints,
  // ensuring that keyboard events received immediately after render find the container focused.
  useLayoutEffect(() => { containerRef.current?.focus({ preventScroll: true }); }, []);

  // Re-focus the container when a trace finishes loading so keyboard nav works immediately
  // after clicking a trace item. The trace item in the list captures focus on click, so without
  // this the BUG-026 guard would block j/k/Arrow events (focus outside our container).
  useLayoutEffect(() => {
    if (!loading && spans && spans.length > 0) {
      containerRef.current?.focus({ preventScroll: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traceId, loading]);

  // Keyboard navigation: j/k or ArrowUp/ArrowDown to navigate spans
  // BUG-026: use document listener but guard against events from outside our container so we
  // don't intercept keypresses from other Grafana panels (e.g. Select dropdowns). Events from
  // body/html (no specific focus) are always accepted so navigation works on initial load.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when focus is in a text input anywhere on the page
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      // BUG-026: skip events whose target is outside our container and also not
      // on body/html (which indicates no specific element has focus). This prevents
      // capturing j/k/Arrow when the user is interacting with a different Grafana
      // panel. Events fired while focus is on a span row or the detail panel itself
      // are always processed since those elements live inside containerRef.
      if (containerRef.current) {
        const t2 = e.target as Node | null;
        if (t2 && t2 !== document.body && t2 !== document.documentElement
            && !containerRef.current.contains(t2 as Node)) {
          return;
        }
      }
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        setSelectedSpanId(() => {
          const current = effectiveSelectedRef.current;
          const idx = displayedSpansRef.current.findIndex((s) => s.spanId === current);
          // BUG-017: when idx === -1 (span not in displayed list), start from first item
          const safeIdx = idx === -1 ? 0 : idx;
          const next = displayedSpansRef.current[safeIdx + 1] ?? displayedSpansRef.current[safeIdx];
          return next ? next.spanId : current;
        });
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        setSelectedSpanId(() => {
          const current = effectiveSelectedRef.current;
          const idx = displayedSpansRef.current.findIndex((s) => s.spanId === current);
          // BUG-017: when idx === -1, wrap to last item
          const safeIdx = idx === -1 ? displayedSpansRef.current.length - 1 : idx;
          const next = displayedSpansRef.current[safeIdx - 1] ?? displayedSpansRef.current[safeIdx];
          return next ? next.spanId : current;
        });
      } else if (e.key === 'Escape') {
        // BUG-077: set dismissed flag so firstLlmSpan auto-fill is suppressed
        setSelectedSpanId(null);
        setUserDismissedDetail(true);
      }
    };
    // Use capture phase so Grafana's own keyboard-shortcut listeners (which may call
    // stopPropagation during bubbling) cannot swallow our events before we see them.
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, []);

  const selectedSpan = flatSpans.find((s) => s.spanId === effectiveSelectedSpanId) || null;

  // Auto-select first LLM span if nothing selected.
  // BUG-001 follow-up: prefer non-GUARDRAIL LLM spans (guardrails are secondary/audit spans);
  // fall back to any LLM span (including GUARDRAIL) if no non-guardrail LLM spans exist.
  const firstLlmSpan = flatSpans.find((s) => isLlmSpan(s.tags) && !isGuardrailSpan(s.tags))
    ?? flatSpans.find((s) => isLlmSpan(s.tags));

  // BUG-007: explicitly call setSelectedSpanId for auto-selection so it shows in state
  useEffect(() => {
    if (selectedSpanId === null && !userDismissedDetail && firstLlmSpan) {
      setSelectedSpanId(firstLlmSpan.spanId);
    }
  }, [selectedSpanId, userDismissedDetail, firstLlmSpan]);

  // Track the actually-displayed span for keyboard navigation
  effectiveSelectedRef.current = (selectedSpan ?? firstLlmSpan)?.spanId ?? null;

  return (
    <div className={styles.root} data-testid="trace-detail-view" ref={containerRef} tabIndex={-1}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onBack}>
          <Icon name="arrow-left" size="sm" />
          Back
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className={styles.traceTitle}>
            {derivedRootName || traceId}
          </div>
          <div className={styles.traceId}>{traceId}</div>
        </div>
      </div>

      {!loading && !error && spans && (
        <div className={styles.statsRow} data-testid="trace-stats-row">
          <div className={styles.stat}>
            <span className={styles.statLabel}>Duration</span>
            <span className={styles.statValue}>{formatDuration(traceDurationMs)}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Spans</span>
            <span className={styles.statValue}>{flatSpans.length}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>LLM Spans</span>
            <span className={styles.statValue} data-testid="llm-span-count">{llmSpanCount}</span>
          </div>
          {totalTokens !== null && (
            <div className={styles.stat}>
              <span className={styles.statLabel}>Tokens</span>
              <span className={styles.statValue}>{totalTokens.toLocaleString()}</span>
            </div>
          )}
          {totalCostUsd !== null && (
            <div className={styles.stat}>
              <span
                className={styles.statLabel}
                title={costIsPartial ? 'Some spans have unknown pricing and are excluded from this total.' : undefined}
              >
                {costIsMixed ? 'Cost' : 'Est. Cost'}{costIsPartial ? '*' : ''}
              </span>
              <span className={styles.statValue}>{costIsMixed ? `~${formatCost(totalCostUsd)}` : formatCost(totalCostUsd)}</span>
            </div>
          )}
        </div>
      )}

      {loading && (
        <>
          {/* Stats bar skeleton — intentionally NOT using data-testid="trace-stats-row" to avoid
              conflicting with the real stats bar that renders once spans are loaded */}
          <div className={styles.traceLoaderStatsBar}>
            {[70, 50, 60, 80].map((w, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div className={styles.shimmer} style={{ height: '10px', width: `${w * 0.6}px` }} />
                <div className={styles.shimmer} style={{ height: '14px', width: `${w}px` }} />
              </div>
            ))}
          </div>
          {/* Two-pane skeleton — intentionally NOT using data-testid="span-list-pane" since
              tests use that testid to detect when real spans have loaded */}
          <div className={styles.traceLoader}>
            {/* Left — span list skeleton */}
            <div className={styles.traceLoaderLeft}>
              {/* Column header */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '6px 8px', borderBottom: `2px solid var(--border-medium, #333)`,
                background: 'rgba(0,0,0,0.15)',
              }}>
                <div className={styles.shimmer} style={{ height: '10px', flex: 1 }} />
                <div className={styles.shimmer} style={{ height: '10px', width: '60px' }} />
                <div className={styles.shimmer} style={{ height: '10px', width: '120px' }} />
              </div>
              {/* Span rows — varying indentations to look like a real tree */}
              {[
                { indent: 0, nameW: 180, barW: 110, barOff: 0, isLlm: false },
                { indent: 16, nameW: 140, barW: 80, barOff: 5, isLlm: true },
                { indent: 32, nameW: 110, barW: 55, barOff: 10, isLlm: false },
                { indent: 16, nameW: 155, barW: 95, barOff: 40, isLlm: true },
                { indent: 0, nameW: 170, barW: 100, barOff: 0, isLlm: false },
                { indent: 16, nameW: 130, barW: 70, barOff: 8, isLlm: true },
                { indent: 32, nameW: 100, barW: 50, barOff: 15, isLlm: false },
                { indent: 32, nameW: 120, barW: 65, barOff: 20, isLlm: true },
                { indent: 16, nameW: 145, barW: 85, barOff: 55, isLlm: false },
              ].map((row, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '7px 8px', paddingLeft: `${8 + row.indent}px`,
                  borderBottom: `1px solid rgba(128,128,128,0.1)`,
                  background: row.isLlm ? 'rgba(98,110,212,0.04)' : undefined,
                }}>
                  {/* expand arrow placeholder */}
                  <div style={{ width: '10px', flexShrink: 0 }} />
                  {/* coloured dot for span kind */}
                  <div style={{
                    width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
                    background: row.isLlm ? 'rgba(98,110,212,0.5)' : 'rgba(128,128,128,0.3)',
                  }} />
                  {/* name bar */}
                  <div className={styles.shimmer} style={{ height: '11px', width: `${row.nameW}px`, flex: 'none' }} />
                  {/* duration */}
                  <div className={styles.shimmer} style={{ height: '10px', width: '38px', marginLeft: 'auto', flexShrink: 0 }} />
                  {/* timeline bar container */}
                  <div style={{ width: '120px', flexShrink: 0, position: 'relative', height: '10px' }}>
                    <div className={styles.shimmer} style={{
                      position: 'absolute',
                      left: `${row.barOff}px`,
                      height: '10px',
                      width: `${row.barW}px`,
                      borderRadius: '3px',
                    }} />
                  </div>
                </div>
              ))}
            </div>
            {/* Right — detail skeleton */}
            <div className={styles.traceLoaderRight}>
              {/* LLM badge + model name area */}
              <div style={{ padding: '12px 16px', borderBottom: `1px solid rgba(128,128,128,0.15)` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <div className={styles.shimmer} style={{ height: '18px', width: '50px', borderRadius: '9px' }} />
                  <div className={styles.shimmer} style={{ height: '18px', width: '120px', borderRadius: '9px' }} />
                </div>
                <div style={{ display: 'flex', gap: '16px' }}>
                  {[60, 80, 55, 70].map((w, i) => (
                    <div key={i}>
                      <div className={styles.shimmer} style={{ height: '10px', width: `${w * 0.7}px`, marginBottom: '4px' }} />
                      <div className={styles.shimmer} style={{ height: '13px', width: `${w}px` }} />
                    </div>
                  ))}
                </div>
              </div>
              {/* Messages skeleton */}
              {[
                { label: 80, lines: [{ w: '92%' }, { w: '85%' }, { w: '60%' }] },
                { label: 70, lines: [{ w: '88%' }, { w: '75%' }, { w: '95%' }, { w: '40%' }] },
              ].map((section, si) => (
                <div key={si} style={{ padding: '12px 16px', borderBottom: `1px solid rgba(128,128,128,0.1)` }}>
                  <div className={styles.shimmer} style={{ height: '10px', width: `${section.label}px`, marginBottom: '10px' }} />
                  {section.lines.map((l, li) => (
                    <div key={li} className={styles.shimmer} style={{ height: '11px', width: l.w, marginBottom: '6px', borderRadius: '2px' }} />
                  ))}
                </div>
              ))}
              {/* Attr table skeleton */}
              <div style={{ padding: '12px 16px' }}>
                <div className={styles.shimmer} style={{ height: '10px', width: '100px', marginBottom: '10px' }} />
                {[
                  [120, 160], [90, 200], [140, 90], [110, 140], [80, 180],
                ].map(([kw, vw], i) => (
                  <div key={i} style={{ display: 'flex', gap: '16px', marginBottom: '8px' }}>
                    <div className={styles.shimmer} style={{ height: '11px', width: `${kw}px`, flexShrink: 0 }} />
                    <div className={styles.shimmer} style={{ height: '11px', width: `${vw}px` }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
      {error && <Alert title={error} severity="error" />}

      {spans && (
        <div className={styles.body}>
          {listPaneOpen && (
            <div
              className={styles.spanListPane}
              data-testid="span-list-pane"
              style={{
                width: detailPaneOpen ? spanListWidth : '100%',
                minWidth: detailPaneOpen ? SPAN_LIST_MIN_WIDTH : undefined,
                maxWidth: detailPaneOpen ? `calc(100% - ${SPAN_DETAIL_RESERVED_WIDTH}px)` : undefined,
              }}
            >
              <div className={styles.columnHeader}>
                <span className={styles.colName}>Span</span>
                <span className={styles.colDuration}>Duration</span>
                <span className={styles.colBar}>Timeline</span>
                <button
                  onClick={handleExpandAll}
                  title="Expand all spans"
                  aria-label="Expand all spans"
                  style={{
                    marginLeft: theme.spacing(0.5),
                    padding: `${theme.spacing(0.25)} ${theme.spacing(0.5)}`,
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: theme.colors.text.secondary,
                    fontSize: '10px',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <Icon name="angle-double-down" size="xs" />
                </button>
                <button
                  onClick={handleCollapseAll}
                  title="Collapse all spans"
                  aria-label="Collapse all spans"
                  style={{
                    padding: `${theme.spacing(0.25)} ${theme.spacing(0.5)}`,
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: theme.colors.text.secondary,
                    fontSize: '10px',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <Icon name="angle-double-up" size="xs" />
                </button>
                <button
                  onClick={() => setAiOnly((v) => !v)}
                  title="Show only AI spans"
                  aria-label="Filter AI spans only"
                  aria-pressed={aiOnly}
                  style={{
                    marginLeft: theme.spacing(1),
                    padding: `${theme.spacing(0.25)} ${theme.spacing(0.75)}`,
                    borderRadius: '10px',
                    border: aiOnly ? 'none' : `1px solid ${theme.colors.border.medium}`,
                    background: aiOnly ? theme.colors.primary.main : 'none',
                    color: aiOnly ? '#fff' : theme.colors.text.secondary,
                    fontSize: '10px',
                    fontWeight: theme.typography.fontWeightMedium,
                    cursor: 'pointer',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    lineHeight: 1.4,
                  }}
                >
                  AI only
                </button>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: theme.spacing(0.5) }}>
                  <button
                    onClick={() => setListPaneOpen(false)}
                    title="Collapse span list"
                    aria-label="Collapse span list"
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: theme.colors.text.secondary,
                      display: 'flex',
                      alignItems: 'center',
                      padding: theme.spacing(0.25),
                      borderRadius: theme.shape.radius.default,
                    }}
                  >
                    <Icon name="angle-left" size="sm" />
                  </button>
                  <button
                    onClick={() => setDetailPaneOpen((v) => !v)}
                    title={detailPaneOpen ? 'Collapse detail panel' : 'Expand detail panel'}
                    aria-label={detailPaneOpen ? 'Collapse detail panel' : 'Expand detail panel'}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: theme.colors.text.secondary,
                      display: 'flex',
                      alignItems: 'center',
                      padding: theme.spacing(0.25),
                      borderRadius: theme.shape.radius.default,
                    }}
                  >
                    <Icon name={detailPaneOpen ? 'angle-right' : 'angle-left'} size="sm" />
                  </button>
                </div>
              </div>
              {/* Span filter input */}
              <div className={styles.spanFilterRow}>
                <Icon name="search" size="sm" style={{ color: 'inherit', opacity: 0.5, flexShrink: 0 }} />
                <input
                  className={styles.spanFilterInput}
                  type="text"
                  placeholder="Filter spans by name or attribute…"
                  value={spanFilter}
                  onChange={(e) => setSpanFilter(e.target.value)}
                  data-testid="span-filter-input"
                  aria-label="Filter spans"
                />
                {spanFilter && (
                  <>
                    <span className={styles.spanFilterCount} data-testid="span-filter-count">
                      {displayedSpans.length} match{displayedSpans.length !== 1 ? 'es' : ''}
                    </span>
                    <button
                      className={styles.spanFilterClear}
                      onClick={() => setSpanFilter('')}
                      title="Clear filter"
                      aria-label="Clear span filter"
                      data-testid="span-filter-clear"
                    >
                      <Icon name="times" size="sm" />
                    </button>
                  </>
                )}
              </div>

              {/* BUG-042: empty trace state */}
              {spans && spans.length === 0 && (
                <div className={styles.detailPlaceholder} data-testid="empty-trace-message">
                  No spans found in this trace
                </div>
              )}

              {/* BUG-060: filter produced no results */}
              {displayedSpans.length === 0 && (aiOnly || spanFilter.trim() !== '') && (spans && spans.length > 0) && (
                <div className={styles.detailPlaceholder} data-testid="empty-filter-message">
                  No matching spans. Try adjusting your filters.
                </div>
              )}

              {/* BUG-006: compute min depth among AI-only spans for relative depth display */}
              {(() => {
                const minAiDepth = aiOnly && displayedSpans.length > 0
                  ? Math.min(...displayedSpans.map((s) => s.depth ?? 0))
                  : 0;
                return displayedSpans.map((span, i) => (
                  // BUG-024: include array index in key to avoid duplicate spanId collisions
                  <SpanRow
                    key={span.spanId + '-' + i}
                    span={span}
                    isSelected={span.spanId === effectiveSelectedSpanId}
                    isExpanded={!collapsed.has(span.spanId)}
                    onToggleExpand={handleToggleExpand}
                    onClick={handleSelectSpan}
                    traceStartMs={traceStartMs}
                    traceDurationMs={traceDurationMs}
                    displayDepth={aiOnly ? (span.depth ?? 0) - minAiDepth : undefined}
                  />
                ));
              })()}
            </div>
          )}

          {listPaneOpen && detailPaneOpen && (
            <div
              className={styles.resizeHandle}
              data-testid="resize-handle-span-list"
              onMouseDown={onSpanListResize}
            />
          )}

          {!listPaneOpen && (
            <button
              className={styles.expandHandle}
              onClick={() => setListPaneOpen(true)}
              title="Expand span list"
              aria-label="Expand span list"
            >
              <Icon name="angle-right" size="sm" />
            </button>
          )}

          {detailPaneOpen && (
            <div className={styles.detailPane} data-testid="span-detail-pane">
              {/* BUG-011: if selectedSpanId is set but not visible, show a collapsed indicator */}
              {selectedSpanId && !displayedSpans.some((s) => s.spanId === selectedSpanId) ? (
                <div className={styles.detailPlaceholder} data-testid="span-collapsed-message">
                  <Icon name="eye-slash" size="xl" />
                  <span>Selected span is collapsed.</span>
                  <button
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', textDecoration: 'underline' }}
                    onClick={handleExpandAll}
                  >
                    Click to expand.
                  </button>
                </div>
              ) : selectedSpan ? (
                /* BUG-025: key prop forces React to remount on span change, preventing leaked UI state */
                <SpanDetailPanel key={selectedSpan.spanId} span={selectedSpan} />
              ) : firstLlmSpan && !userDismissedDetail ? (
                <SpanDetailPanel key={firstLlmSpan.spanId} span={firstLlmSpan} />
              ) : (
                <div className={styles.detailPlaceholder}>
                  <Icon name="arrow-right" size="xl" />
                  <span>Click a span to see details</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

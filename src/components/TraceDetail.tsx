import React, { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';

import { useResize } from '../utils/useResize';

import { useStyles2, useTheme2, Alert, Icon } from '@grafana/ui';
import { getStyles, SPAN_DETAIL_RESERVED_WIDTH, SPAN_LIST_MIN_WIDTH } from './TraceDetail.styles';

import { PluginSpan, flattenTree, getTraceDurationMs, getTraceStartMs } from '../utils/tempoClient';
import { isLlmSpan, isGuardrailSpan, isAiSpan, extractLlmSpanData } from '../utils/llmUtils';
import { estimateCost, formatCost } from '../utils/costUtils';
import { formatDuration } from '../utils/formatUtils';
import { clampNameColumnFraction, loadNameColumnFraction, saveNameColumnFraction } from '../utils/nameColumn';
import { collapseOneLevel, expandOneLevel, getParentSpanIds, getSpanAgents, getVisibleSpans, indexSpans, revealSpan } from '../utils/traceTree';
import { getAgentColors } from '../utils/agentColors';
import { useVirtualList } from '../utils/useVirtualList';
import { AgentLayer, GuideContext, NAME_MIN_WIDTH, SPAN_ROW_HEIGHT, SpanRow } from './SpanRow';
import { SpanDetailPanel } from './SpanDetailPanel';
import { NameColumnResizer } from './NameColumnResizer';

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
  const [nameColumnFraction, setNameColumnFraction] = useState(loadNameColumnFraction);
  const [hoveredGuideIds, setHoveredGuideIds] = useState<Set<string>>(() => new Set());
  const [paneElement, setPaneElement] = useState<HTMLDivElement | null>(null);
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const [nameHeaderElement, setNameHeaderElement] = useState<HTMLDivElement | null>(null);
  // Until the header is measured, assume the default pane width and name column.
  const [nameColumnWidth, setNameColumnWidth] = useState(200);
  const listHeaderRef = useRef<HTMLDivElement>(null);
  const columnHeaderRef = useRef<HTMLDivElement>(null);
  const displayedSpansRef = useRef<PluginSpan[]>([]);
  const displayedIndexByIdRef = useRef<Map<string, number>>(new Map());
  const spanByIdRef = useRef<Map<string, PluginSpan>>(new Map());
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

  const flatSpans = useMemo(() => spans ? flattenTree(spans) : [], [spans]);
  const spanById = useMemo(() => indexSpans(flatSpans), [flatSpans]);
  spanByIdRef.current = spanById;
  const spanAgents = useMemo(() => spans ? getSpanAgents(spans) : new Map(), [spans]);
  const agentColors = useMemo(() => getAgentColors(theme), [theme]);
  const agentLayer = useMemo<AgentLayer>(() => ({ byId: spanAgents, colors: agentColors }), [spanAgents, agentColors]);

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
    // BUG-058: clear text filter when collapsing all to avoid silently hiding matching spans
    setSpanFilter('');
    const allParentIds = getParentSpanIds(flatSpans);
    // BUG-023: when AI-only mode is active, skip collapsing direct parents of AI spans
    if (aiOnly) {
      const aiSpanParentIds = new Set<string>(
        flatSpans
          .filter((s) => isAiSpan(s.tags) && s.parentSpanId)
          .map((s) => s.parentSpanId!)
      );
      setCollapsed(new Set(allParentIds.filter((id) => !aiSpanParentIds.has(id))));
    } else {
      setCollapsed(new Set(allParentIds));
    }
  }, [flatSpans, aiOnly]);

  const handleExpandAll = useCallback(() => {
    setCollapsed(new Set());
  }, []);

  const handleCollapseOne = useCallback(() => {
    setSpanFilter('');
    setCollapsed((prev) => collapseOneLevel(flatSpans, prev));
  }, [flatSpans]);

  const handleExpandOne = useCallback(() => {
    setCollapsed((prev) => expandOneLevel(flatSpans, prev));
  }, [flatSpans]);

  // Selecting a span opens the collapsed spans above it, so the selection is never hidden.
  const selectSpan = useCallback((spanId: string) => {
    setCollapsed((prev) => revealSpan(spanId, spanByIdRef.current, prev));
    setSelectedSpanId(spanId);
  }, []);

  const handleSelectSpan = useCallback((span: PluginSpan) => {
    setUserDismissedDetail(false);
    selectSpan(span.spanId);
  }, [selectSpan]);

  const handleGuideHoverStart = useCallback((ancestorId: string) => {
    setHoveredGuideIds((prev) => (prev.has(ancestorId) ? prev : new Set(prev).add(ancestorId)));
  }, []);

  const handleGuideHoverEnd = useCallback((ancestorId: string) => {
    setHoveredGuideIds((prev) => {
      if (!prev.has(ancestorId)) { return prev; }
      const next = new Set(prev);
      next.delete(ancestorId);
      return next;
    });
  }, []);

  const collapseActionsRef = useRef({ collapseAll: handleCollapseAll, expandAll: handleExpandAll, collapseOne: handleCollapseOne, expandOne: handleExpandOne });
  collapseActionsRef.current = { collapseAll: handleCollapseAll, expandAll: handleExpandAll, collapseOne: handleCollapseOne, expandOne: handleExpandOne };

  const handleNameColumnResize = useCallback((fraction: number) => {
    const clamped = clampNameColumnFraction(fraction);
    setNameColumnFraction(clamped);
    saveNameColumnFraction(clamped);
  }, []);

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
          const cost = estimateCost(llmData.model, llmData.tokenUsage.input, llmData.tokenUsage.output, llmData.tokenUsage);
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
  const visibleSpans = useMemo(() => spans ? getVisibleSpans(spans, collapsed) : [], [spans, collapsed]);

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

  // First row of each span id, so selection and scrolling find a row without scanning the list.
  const displayedIndexById = useMemo(() => {
    const indexById = new Map<string, number>();
    displayedSpans.forEach((span, i) => {
      if (!indexById.has(span.spanId)) { indexById.set(span.spanId, i); }
    });
    return indexById;
  }, [displayedSpans]);
  displayedIndexByIdRef.current = displayedIndexById;

  // Derive effective selected span: if selectedSpanId is not in displayedSpans, treat as null
  const effectiveSelectedSpanId = selectedSpanId !== null && displayedIndexById.has(selectedSpanId) ? selectedSpanId : null;

  // BUG-006: the shallowest AI span is drawn at depth 0 in AI-only mode
  const minAiDepth = useMemo(() => {
    if (!aiOnly) { return 0; }
    let min = Infinity;
    for (const span of displayedSpans) { min = Math.min(min, span.depth ?? 0); }
    return min === Infinity ? 0 : min;
  }, [aiOnly, displayedSpans]);

  // Rows share the width of the name column in the header, which is where the guides, name and chevron have to fit.
  useLayoutEffect(() => {
    if (!nameHeaderElement) { return undefined; }
    const measure = () => setNameColumnWidth(Math.floor(nameHeaderElement.getBoundingClientRect().width));
    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(nameHeaderElement);
    return () => resizeObserver.disconnect();
  }, [nameHeaderElement]);

  const remPx = useMemo(() => parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16, []);

  const { start: renderedStart, end: renderedEnd, scrollToIndex } = useVirtualList({
    scrollElement: paneElement,
    listElement,
    itemCount: displayedSpans.length,
    itemHeight: SPAN_ROW_HEIGHT,
  });

  const guideContext = useMemo<GuideContext>(() => ({
    spanById,
    indexById: displayedIndexById,
    renderedStart,
    renderedEnd,
    remPx,
    guideAreaMax: nameColumnWidth - NAME_MIN_WIDTH,
    hoveredIds: hoveredGuideIds,
    onHoverStart: handleGuideHoverStart,
    onHoverEnd: handleGuideHoverEnd,
  }), [spanById, displayedIndexById, renderedStart, renderedEnd, remPx, nameColumnWidth, hoveredGuideIds, handleGuideHoverStart, handleGuideHoverEnd]);

  // Scroll selected span into view when selection changes
  useEffect(() => {
    if (!selectedSpanId) { return; }
    const index = displayedIndexByIdRef.current.get(selectedSpanId);
    if (index !== undefined) { scrollToIndex(index, listHeaderRef.current?.offsetHeight ?? 0); }
  }, [selectedSpanId, scrollToIndex]);

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
      const spansShown = displayedSpansRef.current;
      const currentIndex = displayedIndexByIdRef.current.get(effectiveSelectedRef.current ?? '') ?? -1;
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        // BUG-017: when the selected span is not in the displayed list, start from first item
        const safeIdx = currentIndex === -1 ? 0 : currentIndex;
        const next = spansShown[safeIdx + 1] ?? spansShown[safeIdx];
        if (next) { selectSpan(next.spanId); }
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        // BUG-017: when the selected span is not in the displayed list, wrap to last item
        const safeIdx = currentIndex === -1 ? spansShown.length - 1 : currentIndex;
        const next = spansShown[safeIdx - 1] ?? spansShown[safeIdx];
        if (next) { selectSpan(next.spanId); }
      } else if (e.key === 'Escape') {
        // BUG-077: set dismissed flag so firstLlmSpan auto-fill is suppressed
        setSelectedSpanId(null);
        setUserDismissedDetail(true);
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        // Same keys as Grafana's trace view.
        const actions = collapseActionsRef.current;
        if (e.key === ']') { actions.collapseAll(); }
        else if (e.key === '[') { actions.expandAll(); }
        else if (e.key === 'p') { actions.collapseOne(); }
        else if (e.key === 'o') { actions.expandOne(); }
      }
    };
    // Use capture phase so Grafana's own keyboard-shortcut listeners (which may call
    // stopPropagation during bubbling) cannot swallow our events before we see them.
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [selectSpan]);

  const selectedSpan = (effectiveSelectedSpanId !== null && spanById.get(effectiveSelectedSpanId)) || null;

  // Auto-select first LLM span if nothing selected.
  // BUG-001 follow-up: prefer non-GUARDRAIL LLM spans (guardrails are secondary/audit spans);
  // fall back to any LLM span (including GUARDRAIL) if no non-guardrail LLM spans exist.
  const firstLlmSpan = useMemo(
    () => flatSpans.find((s) => isLlmSpan(s.tags) && !isGuardrailSpan(s.tags)) ?? flatSpans.find((s) => isLlmSpan(s.tags)),
    [flatSpans]
  );

  // BUG-007: explicitly select for auto-selection so it shows in state
  useEffect(() => {
    if (selectedSpanId === null && !userDismissedDetail && firstLlmSpan) {
      selectSpan(firstLlmSpan.spanId);
    }
  }, [selectedSpanId, userDismissedDetail, firstLlmSpan, selectSpan]);

  const iconButtonStyle: React.CSSProperties = {
    padding: `${theme.spacing(0.25)} ${theme.spacing(0.5)}`,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: theme.colors.text.secondary,
    fontSize: '10px',
    display: 'flex',
    alignItems: 'center',
  };

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
              ref={setPaneElement}
              style={{
                width: detailPaneOpen ? spanListWidth : '100%',
                minWidth: detailPaneOpen ? SPAN_LIST_MIN_WIDTH : undefined,
                maxWidth: detailPaneOpen ? `calc(100% - ${SPAN_DETAIL_RESERVED_WIDTH}px)` : undefined,
                '--llt-name-column': nameColumnFraction,
              } as React.CSSProperties}
            >
              <div className={styles.listHeader} ref={listHeaderRef}>
                <div className={styles.toolbar}>
                  <button
                    onClick={handleExpandOne}
                    title="Expand +1"
                    aria-label="Expand +1"
                    style={iconButtonStyle}
                  >
                    <Icon name="angle-down" size="xs" />
                  </button>
                  <button
                    onClick={handleCollapseOne}
                    title="Collapse +1"
                    aria-label="Collapse +1"
                    style={iconButtonStyle}
                  >
                    <Icon name="angle-up" size="xs" />
                  </button>
                  <button
                    onClick={handleExpandAll}
                    title="Expand all spans"
                    aria-label="Expand all spans"
                    style={iconButtonStyle}
                  >
                    <Icon name="angle-double-down" size="xs" />
                  </button>
                  <button
                    onClick={handleCollapseAll}
                    title="Collapse all spans"
                    aria-label="Collapse all spans"
                    style={iconButtonStyle}
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
                <div className={styles.columnHeader} ref={columnHeaderRef}>
                  <div className={styles.colNameCell} data-testid="span-list-name-header" ref={setNameHeaderElement}>
                    <span className={styles.colName}>Span</span>
                    <NameColumnResizer rowRef={columnHeaderRef} scrollElement={paneElement} onChange={handleNameColumnResize} />
                  </div>
                  <span className={styles.colDuration}>Duration</span>
                  <span className={styles.colBar}>Timeline</span>
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

              {/* Only the rows near the viewport are in the DOM; the list is as tall as all rows together. */}
              <div
                className={styles.spanList}
                ref={setListElement}
                style={{ height: displayedSpans.length * SPAN_ROW_HEIGHT }}
                onMouseLeave={() => setHoveredGuideIds((prev) => (prev.size === 0 ? prev : new Set()))}
              >
                {displayedSpans.slice(renderedStart, renderedEnd + 1).map((span, offset) => {
                  const i = renderedStart + offset;
                  return (
                    // BUG-024: include array index in key to avoid duplicate spanId collisions
                    <SpanRow
                      key={span.spanId + '-' + i}
                      span={span}
                      top={i * SPAN_ROW_HEIGHT}
                      isSelected={span.spanId === effectiveSelectedSpanId}
                      isExpanded={!collapsed.has(span.spanId)}
                      onToggleExpand={handleToggleExpand}
                      onClick={handleSelectSpan}
                      traceStartMs={traceStartMs}
                      traceDurationMs={traceDurationMs}
                      displayDepth={aiOnly ? (span.depth ?? 0) - minAiDepth : undefined}
                      guideContext={guideContext}
                      agentLayer={agentLayer}
                    />
                  );
                })}
              </div>
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
              {selectedSpanId && !displayedIndexById.has(selectedSpanId) ? (
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
                <SpanDetailPanel key={selectedSpan.spanId} span={selectedSpan} agentLayer={agentLayer} />
              ) : firstLlmSpan && !userDismissedDetail ? (
                <SpanDetailPanel key={firstLlmSpan.spanId} span={firstLlmSpan} agentLayer={agentLayer} />
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

import React, { memo } from 'react';

import { css, cx } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2, Icon } from '@grafana/ui';

import { PluginSpan } from '../utils/tempoClient';
import { getAncestorIds } from '../utils/traceTree';
import { hiddenLevelsWidth, layoutGuides } from '../utils/guideLayout';
import { getSpanKindColor, getSpanKind, getAgentName } from '../utils/llmUtils';
import { formatDuration } from '../utils/formatUtils';

export const SPAN_ROW_HEIGHT = 36;
// Space the name keeps when the indent is wider than the name column.
export const NAME_MIN_WIDTH = 72;

const getStyles = (theme: GrafanaTheme2) => ({
  row: css({
    position: 'absolute',
    left: 0,
    right: 0,
    boxSizing: 'border-box',
    height: `${SPAN_ROW_HEIGHT}px`,
    display: 'flex',
    alignItems: 'center',
    padding: `0 ${theme.spacing(1)}`,
    cursor: 'pointer',
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    '&:hover': {
      background: theme.colors.action.hover,
    },
  }),
  rowSelected: css({
    background: `${theme.colors.primary.transparent} !important`,
    '&::before': {
      content: '""',
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: '3px',
      background: theme.colors.primary.main,
    },
  }),
  rowError: css({
    '&::before': {
      content: '""',
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: '3px',
      background: theme.colors.error.border,
    },
  }),
  // Same width as the name column in the header, so the columns line up.
  nameCell: css({
    flex: '0 1 calc(var(--llt-name-column, 0.4) * 100%)',
    minWidth: 0,
    alignSelf: 'stretch',
    display: 'flex',
    alignItems: 'center',
    overflow: 'hidden',
  }),
  // Guides start at the left edge of the row and keep their x on every row. Their width is set from the
  // layout in guideLayout.ts: the part of the guides that does not fit is cut off at the right edge.
  guides: css({
    position: 'relative',
    flex: '0 0 auto',
    alignSelf: 'stretch',
    display: 'flex',
  }),
  guidesClip: css({
    flex: '0 0 auto',
    alignSelf: 'stretch',
    display: 'flex',
    overflow: 'hidden',
  }),
  hiddenLevels: css({
    flex: '0 0 auto',
    alignSelf: 'center',
    textAlign: 'right',
    fontSize: '10px',
    lineHeight: 1,
    whiteSpace: 'nowrap',
    color: theme.colors.text.secondary,
    cursor: 'default',
  }),
  guide: css({
    flexShrink: 0,
    display: 'flex',
    // Room for the chevron of the span the guide belongs to; the line itself is the 1px ::before.
    paddingRight: '1rem',
    [theme.transitions.handleMotion('no-preference')]: {
      transition: 'padding 300ms ease-out',
    },
    '&::before': {
      content: '""',
      width: '1px',
      backgroundColor: theme.colors.border.medium,
    },
  }),
  guideActive: css({
    '&::before': {
      backgroundColor: theme.colors.text.secondary,
    },
  }),
  guideThin: css({
    paddingRight: '0.3rem',
  }),
  chevron: css({
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: '1rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: theme.colors.text.secondary,
  }),
  nameCol: css({
    flex: `1 0 ${NAME_MIN_WIDTH}px`,
    minWidth: 0,
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
  }),
  spanName: css({
    fontSize: theme.typography.bodySmall.fontSize,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: theme.colors.text.primary,
  }),
  serviceName: css({
    fontSize: '11px',
    color: theme.colors.text.secondary,
    // Gives up its space long before the span name does.
    flexShrink: 1000,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }),
  kindBadge: css({
    fontSize: '10px',
    padding: `1px 5px`,
    borderRadius: '3px',
    fontWeight: theme.typography.fontWeightMedium,
    color: '#fff',
    flexShrink: 0,
    letterSpacing: '0.03em',
  }),
  agentName: css({
    fontSize: '11px',
    color: theme.colors.text.secondary,
    flexShrink: 0,
  }),
  durationCol: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    flexShrink: 0,
    width: '70px',
    textAlign: 'right',
    fontFamily: theme.typography.fontFamilyMonospace,
  }),
  barCol: css({
    flex: '1 1 0',
    minWidth: '40px',
    height: '16px',
    marginLeft: theme.spacing(1),
    position: 'relative',
  }),
  barBg: css({
    position: 'absolute',
    top: '4px',
    bottom: '4px',
    borderRadius: '2px',
    background: theme.colors.primary.main,
    opacity: 0.7,
  }),
  errorDot: css({
    flexShrink: 0,
    width: '14px',
    height: '14px',
    borderRadius: '50%',
    background: theme.colors.error.main,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    '& svg': { color: '#fff' },
  }),
});

function isErrorSpan(span: PluginSpan): boolean {
  if (span.statusCode === 'ERROR') { return true; }
  return span.tags.some((t) => {
    const key = t.key.toLowerCase();
    const val = String(t.value).toLowerCase();
    return (
      (key === 'status.code' && (val === 'error' || val === 'status_code_error' || val === '2')) ||
      (key === 'error' && val === 'true') ||
      key.startsWith('exception.')
    );
  });
}

/** What every row needs to draw its indent guides. */
export interface GuideContext {
  spanById: Map<string, PluginSpan>;
  /** Row index of each displayed span. */
  indexById: Map<string, number>;
  /** The rows currently in the DOM. */
  renderedStart: number;
  renderedEnd: number;
  /** Root font size in pixels; guide widths are given in rem. */
  remPx: number;
  /** The widest the guides, the "+N" marker and the chevron may be together. */
  guideAreaMax: number;
  /** Ancestor ids whose guide line is highlighted. */
  hoveredIds: Set<string>;
  onHoverStart: (ancestorId: string) => void;
  onHoverEnd: (ancestorId: string) => void;
}

const ROOT_GUIDE_ID = 'root';

// Moving between two guides of the same ancestor (e.g. in the next row) keeps the highlight.
const isGuideOf = (target: EventTarget | null, ancestorId: string) =>
  target instanceof HTMLElement && target.dataset.ancestorId === ancestorId;

interface SpanRowProps {
  span: PluginSpan;
  /** Distance from the top of the list, in pixels. */
  top: number;
  isSelected: boolean;
  isExpanded: boolean;
  onToggleExpand: (spanId: string) => void;
  onClick: (span: PluginSpan) => void;
  traceStartMs: number;
  traceDurationMs: number;
  displayDepth?: number;
  guideContext: GuideContext;
}

export const SpanRow = memo(function SpanRow({ span, top, isSelected, isExpanded, onToggleExpand, onClick, traceStartMs, traceDurationMs, displayDepth, guideContext }: SpanRowProps) {
  const styles = useStyles2(getStyles);
  const agentName = getAgentName(span.tags);
  const kindValue = getSpanKind(span.tags);
  const kindColor = getSpanKindColor(kindValue);
  const hasChildren = span.children.length > 0;
  const hasError = isErrorSpan(span);
  const isOrphaned = span.tags.some((t) => t.key === '_orphaned' && t.value === true);

  const rawOffsetPct = traceDurationMs > 0 ? ((span.startTimeMs - traceStartMs) / traceDurationMs) * 100 : 0;
  const offsetPct = Math.max(0, Math.min(100, rawOffsetPct));
  const rawWidthPct = traceDurationMs > 0 ? Math.max((span.durationMs / traceDurationMs) * 100, 0.5) : 0.5;
  const widthPct = Math.min(rawWidthPct, 100 - offsetPct);

  // One guide per ancestor plus a root guide that joins the root spans of a multi-root trace.
  const { spanById, indexById, renderedStart, renderedEnd, remPx, guideAreaMax, hoveredIds, onHoverStart, onHoverEnd } = guideContext;
  const guideIds = [ROOT_GUIDE_ID, ...getAncestorIds(span, spanById, displayDepth ?? span.depth)];
  // An ancestor more than a buffer of rows away from the rendered rows gets a narrow guide, which keeps the
  // indent of a deep span from taking the whole row. The parent's guide always keeps room for the chevron.
  // Whether a guide is narrow depends on its ancestor only, so every row agrees on where each guide is.
  const isNarrow = (index: number) => {
    const ancestorId = guideIds[index];
    if (index === guideIds.length - 1 || ancestorId === ROOT_GUIDE_ID) { return false; }
    const rowIndex = indexById.get(ancestorId);
    return rowIndex !== undefined && (rowIndex < renderedStart || rowIndex > renderedEnd);
  };
  const markerWidth = hiddenLevelsWidth(guideIds.length);
  const layout = layoutGuides(
    guideIds.length,
    (index) => 1 + remPx * (isNarrow(index) ? 0.3 : 1),
    guideAreaMax,
    markerWidth + remPx
  );

  return (
    <div
      className={cx(styles.row, !isSelected && hasError && styles.rowError, isSelected && styles.rowSelected)}
      style={{ top }}
      onClick={() => onClick(span)}
      data-testid={`span-row-${span.spanId}`}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick(span)}
    >
      <div className={styles.nameCell}>
        <div className={styles.guides} style={{ width: layout.areaWidth }}>
          <div className={styles.guidesClip} style={{ width: layout.clipWidth }}>
            {guideIds.slice(0, layout.visible).map((ancestorId, i) => (
              <span
                key={`${i}-${ancestorId}`}
                className={cx(styles.guide, hoveredIds.has(ancestorId) && styles.guideActive, isNarrow(i) && styles.guideThin)}
                data-ancestor-id={ancestorId}
                data-testid="span-indent-guide"
                onMouseEnter={(e) => { if (!isGuideOf(e.relatedTarget, ancestorId)) { onHoverStart(ancestorId); } }}
                onMouseLeave={(e) => { if (!isGuideOf(e.relatedTarget, ancestorId)) { onHoverEnd(ancestorId); } }}
              />
            ))}
          </div>
          {layout.hidden > 0 && (
            <span
              className={styles.hiddenLevels}
              style={{ width: markerWidth }}
              title={`${layout.hidden} more ${layout.hidden === 1 ? 'level' : 'levels'}`}
              data-testid="span-hidden-levels"
            >
              +{layout.hidden}
            </span>
          )}
          {hasChildren && (
            <span
              className={styles.chevron}
              onMouseEnter={(e) => { if (!isGuideOf(e.relatedTarget, span.spanId)) { onHoverStart(span.spanId); } }}
              onMouseLeave={(e) => { if (!isGuideOf(e.relatedTarget, span.spanId)) { onHoverEnd(span.spanId); } }}
            >
              <Icon
                name={isExpanded ? 'angle-down' : 'angle-right'}
                size="sm"
                onClick={(e) => { e.stopPropagation(); onToggleExpand(span.spanId); }}
              />
            </span>
          )}
        </div>

        {/* name + service + kind badge */}
        <div className={styles.nameCol}>
          {hasError && (
            <div className={styles.errorDot} title="Error span">
              <Icon name="exclamation" size="xs" />
            </div>
          )}
          <span className={styles.serviceName}>{span.serviceName}</span>
          <span className={styles.spanName} title={span.operationName}>{span.operationName}</span>
          {kindValue && (
            <span className={styles.kindBadge} style={{ background: kindColor }}>{kindValue.toUpperCase()}</span>
          )}
          {agentName && (
            <span className={styles.agentName}>{agentName}</span>
          )}
          {isOrphaned && (
            <span
              title="Orphaned span: parent span not found in trace"
              style={{ fontSize: '10px', color: '#8E8E8E', flexShrink: 0, marginLeft: '2px', border: '1px solid #8E8E8E', borderRadius: '3px', padding: '0 3px', lineHeight: 1.4 }}
            >
              orphaned
            </span>
          )}
        </div>
      </div>

      {/* duration */}
      <div className={styles.durationCol}>{formatDuration(span.durationMs)}</div>

      {/* timeline bar */}
      <div className={styles.barCol}>
        <div
          className={styles.barBg}
          style={{
            left: `${offsetPct}%`,
            width: `${widthPct}%`,
            background: kindValue ? kindColor : undefined,
          }}
        />
      </div>
    </div>
  );
});

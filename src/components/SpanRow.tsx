import React, { memo, ReactNode } from 'react';

import { css, cx } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2, Icon } from '@grafana/ui';

import { PluginSpan } from '../utils/tempoClient';
import { getAncestorIds } from '../utils/traceTree';
import { hiddenLevelsWidth, layoutGuides } from '../utils/guideLayout';
import { SpanAgent } from '../utils/traceTree';
import { AgentColor, pickAgentColor } from '../utils/agentColors';
import { getSpanKindColor, getSpanKind } from '../utils/llmUtils';
import { formatDuration } from '../utils/formatUtils';
import { KindIcon } from './KindIcon';

export const SPAN_ROW_HEIGHT = 36;
// Space the name keeps when the indent is wider than the name column.
export const NAME_MIN_WIDTH = 72;
// Height of the one-line groups that hold the service name and the agent items.
const ITEM_LINE_HEIGHT = 20;
const ITEM_NAME_MAX_WIDTH = '16ch';

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
  // The agent rail takes the left edge, so the selection and error bars sit next to it.
  rowWithRail: css({
    '&::before': {
      left: '3px',
    },
  }),
  agentRail: css({
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '3px',
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
  agentLabel: css({
    fontWeight: 600,
  }),
  // The agent item and the service name sit after the span name in one group that is one line tall and clips its
  // overflow. An item that does not fit wraps to the second line and disappears whole; the empty ::before on the
  // first line makes even a lone item wrap instead of being cut off. Items wrap from the end, so the service name
  // goes first, then the agent item. The group shrinks before the span name does, so the span name is cut only when
  // it does not fit alone, and any blank space the group leaves falls after the name, at the end of the row.
  trailingGroup: css({
    display: 'flex',
    flexWrap: 'wrap',
    alignContent: 'flex-start',
    alignItems: 'center',
    flex: '0 1 auto',
    flexShrink: 1e6,
    height: `${ITEM_LINE_HEIGHT}px`,
    minWidth: 0,
    overflow: 'hidden',
    '&::before': {
      content: '""',
      flex: 'none',
      width: 0,
      height: `${ITEM_LINE_HEIGHT}px`,
    },
    '& > *': {
      flexShrink: 0,
    },
    '& > * + *': {
      marginLeft: theme.spacing(0.75),
    },
  }),
  serviceName: css({
    fontSize: '11px',
    color: theme.colors.text.secondary,
    whiteSpace: 'nowrap',
  }),
  handoff: css({
    fontSize: '11px',
    color: theme.colors.text.secondary,
    whiteSpace: 'nowrap',
  }),
  // Long agent names are cut inside the item, which stays one unit that fits whole or is hidden.
  cappedName: css({
    display: 'inline-block',
    maxWidth: ITEM_NAME_MAX_WIDTH,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    verticalAlign: 'bottom',
    whiteSpace: 'nowrap',
  }),
  ownerChip: css({
    padding: '0 6px',
    borderRadius: theme.shape.radius.pill,
    border: '1px solid',
    fontSize: '10px',
    lineHeight: '14px',
    whiteSpace: 'nowrap',
    color: theme.colors.text.primary,
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

/** Who owns each span, and the colours of the owners. */
export interface AgentLayer {
  byId: Map<string, SpanAgent>;
  colors: AgentColor[];
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
  agentLayer: AgentLayer;
}

export const SpanRow = memo(function SpanRow({ span, top, isSelected, isExpanded, onToggleExpand, onClick, traceStartMs, traceDurationMs, displayDepth, guideContext, agentLayer }: SpanRowProps) {
  const styles = useStyles2(getStyles);
  const agent = agentLayer.byId.get(span.spanId);
  const agentColor = agent && pickAgentColor(agentLayer.colors, agent.colorIndex);
  const kindValue = getSpanKind(span.tags);
  const kindColor = getSpanKindColor(kindValue);
  const isAgentSpan = agent !== undefined && kindValue === 'AGENT';
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

  // "from X" on an agent span that was handed the work, the owner chip on any other span of an agent.
  let agentItem: ReactNode = null;
  if (agent && agentColor) {
    if (!isAgentSpan) {
      agentItem = (
        <span className={styles.ownerChip} style={{ background: agentColor.tint, borderColor: agentColor.solid }} title={`Agent: ${agent.name}`} data-testid="span-owner-chip">
          <span className={styles.cappedName}>{agent.name}</span>
        </span>
      );
    } else if (agent.handoffFrom) {
      agentItem = (
        <span className={styles.handoff} title={`Handed off from ${agent.handoffFrom}`} data-testid="span-handoff-from">
          from <span className={styles.cappedName}>{agent.handoffFrom}</span>
        </span>
      );
    }
  }

  return (
    <div
      className={cx(styles.row, !isSelected && hasError && styles.rowError, isSelected && styles.rowSelected, agent && styles.rowWithRail)}
      style={{ top }}
      onClick={() => onClick(span)}
      data-testid={`span-row-${span.spanId}`}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick(span)}
    >
      {agent && agentColor && (
        <span className={styles.agentRail} style={{ background: agentColor.solid }} data-testid="span-agent-rail" data-agent={agent.name} />
      )}
      <div className={styles.nameCell} data-testid="span-name-cell">
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

        {/* kind icon, name, then the handoff or owner chip and the service name */}
        <div className={styles.nameCol} data-testid="span-name-content">
          {hasError && (
            <div className={styles.errorDot} title="Error span">
              <Icon name="exclamation" size="xs" />
            </div>
          )}
          {kindValue && <KindIcon kind={kindValue} />}
          {isAgentSpan ? (
            <span className={cx(styles.spanName, styles.agentLabel)} title={span.operationName} data-testid="span-agent-label">{agent.name}</span>
          ) : (
            <span className={styles.spanName} title={span.operationName} data-testid="span-operation-name">{span.operationName}</span>
          )}
          {isOrphaned && (
            <span
              title="Orphaned span: parent span not found in trace"
              style={{ fontSize: '10px', color: '#8E8E8E', flexShrink: 0, marginLeft: '2px', border: '1px solid #8E8E8E', borderRadius: '3px', padding: '0 3px', lineHeight: 1.4 }}
            >
              orphaned
            </span>
          )}
          {(agentItem || span.serviceName) && (
            <div className={styles.trailingGroup} data-testid="span-trailing-items">
              {agentItem}
              {span.serviceName && (
                <span className={cx(styles.serviceName, styles.cappedName)} title={span.serviceName} data-testid="span-service-name">{span.serviceName}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* duration */}
      <div className={styles.durationCol} data-testid="span-duration">{formatDuration(span.durationMs)}</div>

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

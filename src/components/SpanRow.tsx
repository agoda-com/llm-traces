import React, { memo } from 'react';

import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2, Icon } from '@grafana/ui';

import { PluginSpan } from '../utils/tempoClient';
import { getSpanKindColor, getSpanKind, getAgentName } from '../utils/llmUtils';
import { formatDuration } from '../utils/formatUtils';

const getStyles = (theme: GrafanaTheme2) => ({
  row: css({
    display: 'flex',
    alignItems: 'center',
    padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
    cursor: 'pointer',
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    minHeight: '36px',
    contentVisibility: 'auto',
    containIntrinsicSize: '36px',
    '&:hover': {
      background: theme.colors.action.hover,
    },
  }),
  rowSelected: css({
    background: `${theme.colors.primary.transparent} !important`,
    borderLeft: `3px solid ${theme.colors.primary.main}`,
  }),
  indent: css({
    flexShrink: 0,
  }),
  nameCol: css({
    flex: '1 0 140px',
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
    flex: '0 1 140px',
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
  expandIcon: css({
    flexShrink: 0,
    color: theme.colors.text.secondary,
    width: '16px',
  }),
  rowError: css({
    borderLeft: `3px solid ${theme.colors.error.border}`,
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
    marginRight: theme.spacing(0.5),
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

interface SpanRowProps {
  span: PluginSpan;
  isSelected: boolean;
  isExpanded: boolean;
  onToggleExpand: (spanId: string) => void;
  onClick: (span: PluginSpan) => void;
  traceStartMs: number;
  traceDurationMs: number;
  displayDepth?: number;
}

export const SpanRow = memo(function SpanRow({ span, isSelected, isExpanded, onToggleExpand, onClick, traceStartMs, traceDurationMs, displayDepth }: SpanRowProps) {
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

  return (
    <div
      className={`${styles.row} ${!isSelected && hasError ? styles.rowError : ''} ${isSelected ? styles.rowSelected : ''}`}
      onClick={() => onClick(span)}
      data-testid={`span-row-${span.spanId}`}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick(span)}
    >
      {/* error dot — shown before indent, matches Tempo's red circle indicator */}
      {hasError && (
        <div className={styles.errorDot} title="Error span">
          <Icon name="exclamation" size="xs" />
        </div>
      )}

      {/* indent */}
      <div className={styles.indent} style={{ width: `${Math.min(displayDepth ?? span.depth, 20) * 16}px` }} />

      {/* expand/collapse icon */}
      <div className={styles.expandIcon}>
        {hasChildren && (
          <Icon
            name={isExpanded ? 'angle-down' : 'angle-right'}
            size="sm"
            onClick={(e) => { e.stopPropagation(); onToggleExpand(span.spanId); }}
          />
        )}
      </div>

      {/* name + service + kind badge */}
      <div className={styles.nameCol}>
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

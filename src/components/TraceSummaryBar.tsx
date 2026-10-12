import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import { TempoTraceSearchResult } from '../utils/tempoClient';
import { formatDuration } from '../utils/formatUtils';

const getStyles = (theme: GrafanaTheme2) => ({
  bar: css({
    display: 'flex',
    gap: theme.spacing(2),
    padding: `${theme.spacing(0.5)} ${theme.spacing(1.5)}`,
    background: theme.colors.background.canvas,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    fontSize: '11px',
    color: theme.colors.text.secondary,
    flexWrap: 'wrap',
    flexShrink: 0,
  }),
  stat: css({
    display: 'flex',
    gap: theme.spacing(0.5),
    alignItems: 'center',
    whiteSpace: 'nowrap',
  }),
  statLabel: css({
    color: theme.colors.text.disabled,
  }),
  statValue: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.secondary,
  }),
  divider: css({
    width: '1px',
    background: theme.colors.border.weak,
    margin: `2px 0`,
    alignSelf: 'stretch',
  }),
});


interface TraceSummaryBarProps {
  traces: TempoTraceSearchResult[];
}

export function TraceSummaryBar({ traces }: TraceSummaryBarProps) {
  const styles = useStyles2(getStyles);

  if (traces.length === 0) { return null; }

  const services = new Set(traces.map((t) => t.rootServiceName).filter(Boolean));
  const durations = traces.map((t) => t.durationMs ?? 0).filter((d) => !isNaN(d) && isFinite(d)).sort((a, b) => a - b);
  const avgDuration = durations.length > 0 ? durations.reduce((s, d) => s + d, 0) / durations.length : 0;
  const p95Index = durations.length > 0 ? Math.min(Math.ceil(durations.length * 0.95) - 1, durations.length - 1) : 0;
  const p95Duration = durations.length > 0 ? (durations[p95Index] ?? durations[durations.length - 1]) : 0;
  const errorCount = traces.filter((t) =>
    t.spanSets?.some((ss) =>
      ss.spans?.some((sp) =>
        sp.attributes?.some((a) =>
          (a.key === 'otel.status_code' && String(a.value?.stringValue ?? '').toUpperCase() === 'ERROR') ||
          (a.key === 'status.code' && (String(a.value?.stringValue ?? '').toUpperCase() === 'ERROR' || a.value?.intValue === '2'))
        )
      )
    )
  ).length;

  return (
    <div className={styles.bar} data-testid="trace-summary-bar">
      <div className={styles.stat}>
        <span className={styles.statLabel}>Services</span>
        <span className={styles.statValue}>{services.size}</span>
      </div>
      <div className={styles.divider} />
      <div className={styles.stat}>
        <span className={styles.statLabel}>Avg duration</span>
        <span className={styles.statValue}>{formatDuration(avgDuration)}</span>
      </div>
      <div className={styles.divider} />
      <div className={styles.stat}>
        <span className={styles.statLabel} title="Approximate — based on current result set">P95*</span>
        <span className={styles.statValue}>{formatDuration(p95Duration)}</span>
      </div>
      <div className={styles.divider} />
      <div className={styles.stat}>
        <span className={styles.statLabel}>Slowest</span>
        <span className={styles.statValue}>{formatDuration(durations.reduce((a, b) => Math.max(a, b), 0))}</span>
      </div>
      {errorCount > 0 && (
        <>
          <div className={styles.divider} />
          <div className={styles.stat}>
            <span className={styles.statLabel}>Errors</span>
            <span className={styles.statValue} style={{ color: '#F2495C' }}>{errorCount}</span>
          </div>
        </>
      )}
    </div>
  );
}

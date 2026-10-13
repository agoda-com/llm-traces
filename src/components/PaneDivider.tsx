import React, { useCallback } from 'react';

import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';

import { GRAPH_SPLIT_MAX, GRAPH_SPLIT_MIN, clampGraphSplit } from '../utils/graphSplit';

const DIVIDER_HEIGHT = 7;
const KEY_STEP = 0.05;

const getStyles = (theme: GrafanaTheme2) => ({
  divider: css({
    flexShrink: 0,
    height: `${DIVIDER_HEIGHT}px`,
    cursor: 'row-resize',
    position: 'relative',
    userSelect: 'none',
    background: theme.colors.background.secondary,
    '&::after': {
      content: '""',
      position: 'absolute',
      left: 0,
      right: 0,
      top: '3px',
      height: '1px',
      background: theme.colors.border.medium,
    },
    '&:hover::after, &:focus-visible::after': {
      background: theme.colors.primary.border,
      top: '2px',
      height: '3px',
    },
    '&:focus-visible': { outline: 'none' },
  }),
});

interface PaneDividerProps {
  /** The column that holds both panes and the divider. */
  container: HTMLElement | null;
  /** The share of the column, without the divider, that the upper pane takes. */
  fraction: number;
  /** Called on every step of a drag. */
  onChange: (fraction: number) => void;
  /** Called when a drag ends or a key moves the divider, with the fraction to remember. */
  onCommit: (fraction: number) => void;
}

/** A horizontal divider between two stacked panes. Drag it, or focus it and press the arrow keys. */
export function PaneDivider({ container, fraction, onChange, onCommit }: PaneDividerProps) {
  const styles = useStyles2(getStyles);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (!container) {
      return;
    }
    e.preventDefault();
    const { top, height } = container.getBoundingClientRect();
    const fractionAt = (clientY: number) => clampGraphSplit((clientY - top - DIVIDER_HEIGHT / 2) / (height - DIVIDER_HEIGHT));
    const onMove = (ev: MouseEvent) => onChange(fractionAt(ev.clientY));
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      onCommit(fractionAt(ev.clientY));
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [container, onChange, onCommit]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const step = e.key === 'ArrowUp' ? -KEY_STEP : e.key === 'ArrowDown' ? KEY_STEP : 0;
    if (step !== 0) {
      e.preventDefault();
      const next = clampGraphSplit(fraction + step);
      onChange(next);
      onCommit(next);
    }
  }, [fraction, onChange, onCommit]);

  return (
    <div
      className={styles.divider}
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize span tree and agent graph"
      aria-valuemin={GRAPH_SPLIT_MIN * 100}
      aria-valuemax={GRAPH_SPLIT_MAX * 100}
      aria-valuenow={Math.round(fraction * 100)}
      tabIndex={0}
      data-testid="graph-divider"
      onMouseDown={onMouseDown}
      onKeyDown={onKeyDown}
    />
  );
}

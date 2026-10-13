import React, { RefObject, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';

import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';

import { clampNameColumnFraction } from '../utils/nameColumn';

const getStyles = (theme: GrafanaTheme2) => ({
  handle: css({
    position: 'absolute',
    top: '-6px',
    bottom: '-6px',
    right: '-3px',
    width: '6px',
    cursor: 'col-resize',
    userSelect: 'none',
    zIndex: 1,
    '&::after': {
      content: '""',
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: '2px',
      width: '1px',
      background: theme.colors.border.weak,
    },
    '&:hover::after': {
      background: theme.colors.primary.border,
      left: '1.5px',
      width: '2px',
    },
  }),
  // Follows the pointer while dragging; the columns only move when the button is released.
  ghost: css({
    position: 'fixed',
    width: '2px',
    marginLeft: '-1px',
    background: theme.colors.primary.main,
    opacity: 0.7,
    pointerEvents: 'none',
    zIndex: theme.zIndex.tooltip,
  }),
});

interface NameColumnResizerProps {
  /** The row whose content box the fraction is measured against: the column header. */
  rowRef: RefObject<HTMLElement>;
  /** The element that scrolls the rows; the ghost line covers its height. */
  scrollElement: HTMLElement | null;
  onChange: (fraction: number) => void;
}

/** Drag handle on the right edge of the name column header. Place it inside a positioned element. */
export function NameColumnResizer({ rowRef, scrollElement, onChange }: NameColumnResizerProps) {
  const styles = useStyles2(getStyles);
  const [ghost, setGhost] = useState<{ x: number; top: number; height: number } | null>(null);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const row = rowRef.current;
    if (!row || !scrollElement) {
      return;
    }
    e.preventDefault();
    const rowRect = row.getBoundingClientRect();
    const rowStyle = window.getComputedStyle(row);
    const contentLeft = rowRect.left + parseFloat(rowStyle.paddingLeft);
    const contentWidth = rowRect.width - parseFloat(rowStyle.paddingLeft) - parseFloat(rowStyle.paddingRight);
    const { top, height } = scrollElement.getBoundingClientRect();
    const fractionAt = (clientX: number) => clampNameColumnFraction((clientX - contentLeft) / contentWidth);
    const showGhost = (clientX: number) => setGhost({ x: contentLeft + fractionAt(clientX) * contentWidth, top, height });

    showGhost(e.clientX);
    const onMove = (ev: MouseEvent) => showGhost(ev.clientX);
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setGhost(null);
      onChange(fractionAt(ev.clientX));
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [rowRef, scrollElement, onChange]);

  return (
    <>
      <div
        className={styles.handle}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize name column"
        data-testid="resize-handle-name-column"
        onMouseDown={onMouseDown}
      />
      {ghost && createPortal(
        <div
          className={styles.ghost}
          data-testid="name-column-ghost"
          style={{ left: ghost.x, top: ghost.top, height: ghost.height }}
        />,
        document.body
      )}
    </>
  );
}

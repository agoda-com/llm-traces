import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

export interface RowRange {
  /** First row index. */
  start: number;
  /** Last row index, inclusive. -1 when there are no rows. */
  end: number;
}

/** Rows that intersect the viewport. `viewTop` is the viewport's top edge in list coordinates. */
export function getViewRange(viewTop: number, viewHeight: number, itemHeight: number, itemCount: number): { first: number; last: number } {
  if (itemCount === 0) {
    return { first: 0, last: -1 };
  }
  const clamp = (index: number) => Math.min(itemCount - 1, Math.max(0, index));
  return {
    first: clamp(Math.floor(viewTop / itemHeight)),
    last: clamp(Math.ceil((viewTop + viewHeight) / itemHeight) - 1),
  };
}

/** The rows to put in the DOM: the viewport rows plus `overscan` rows on each side. */
export function getRenderRange(first: number, last: number, itemCount: number, overscan: number): RowRange {
  return { start: Math.max(0, first - overscan), end: Math.min(itemCount - 1, last + overscan) };
}

/** True while the rendered rows still leave at least `margin` rows around the viewport (or reach the list's ends). */
export function coversView(rendered: RowRange, first: number, last: number, itemCount: number, margin: number): boolean {
  return rendered.start <= Math.max(0, first - margin) && rendered.end >= Math.min(itemCount - 1, last + margin);
}

interface UseVirtualListOptions {
  /** The element that scrolls. */
  scrollElement: HTMLElement | null;
  /** The element that holds the rows. It is as tall as all rows together and may sit below other content in scrollElement. */
  listElement: HTMLElement | null;
  itemCount: number;
  itemHeight: number;
  /** Rows rendered above and below the viewport. */
  overscan?: number;
  /** The rendered rows are recomputed once the viewport comes closer than this many rows to their edge. */
  redrawMargin?: number;
  /** Rows rendered before the elements are measured. */
  initialDraw?: number;
}

/** Windowing for a list of fixed-height rows: only the rows near the viewport need to be in the DOM. */
export function useVirtualList({
  scrollElement,
  listElement,
  itemCount,
  itemHeight,
  overscan = 33,
  redrawMargin = 10,
  initialDraw = 100,
}: UseVirtualListOptions) {
  const [state, setState] = useState<RowRange>({ start: 0, end: initialDraw - 1 });

  const measure = useCallback(() => {
    if (!scrollElement || !listElement) {
      return;
    }
    const viewTop = scrollElement.getBoundingClientRect().top - listElement.getBoundingClientRect().top;
    const { first, last } = getViewRange(viewTop, scrollElement.clientHeight, itemHeight, itemCount);
    setState((prev) => (coversView(prev, first, last, itemCount, redrawMargin) ? prev : getRenderRange(first, last, itemCount, overscan)));
  }, [scrollElement, listElement, itemCount, itemHeight, overscan, redrawMargin]);

  // Before paint, so a changed row count never shows rows that were not rendered yet.
  useLayoutEffect(measure, [measure]);

  useEffect(() => {
    if (!scrollElement) {
      return undefined;
    }
    let frame = 0;
    const schedule = () => {
      if (!frame) {
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          measure();
        });
      }
    };
    scrollElement.addEventListener('scroll', schedule, { passive: true });
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(scrollElement);
    return () => {
      scrollElement.removeEventListener('scroll', schedule);
      resizeObserver.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [scrollElement, measure]);

  /**
   * Scrolls just far enough to show row `index`. `topInset` is the height of anything sticky above the rows.
   * Short moves animate; long jumps are instant so the scroll does not sweep through thousands of rows.
   */
  const scrollToIndex = useCallback((index: number, topInset = 0) => {
    if (!scrollElement || !listElement) {
      return;
    }
    const rowTop = listElement.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top + index * itemHeight;
    const rowBottom = rowTop + itemHeight;
    const viewHeight = scrollElement.clientHeight;
    let delta = 0;
    if (rowTop < topInset) {
      delta = rowTop - topInset;
    } else if (rowBottom > viewHeight) {
      delta = rowBottom - viewHeight;
    }
    if (delta !== 0) {
      scrollElement.scrollTo({
        top: scrollElement.scrollTop + delta,
        behavior: Math.abs(delta) < 3 * viewHeight ? 'smooth' : 'auto',
      });
    }
  }, [scrollElement, listElement, itemHeight]);

  const end = Math.min(state.end, itemCount - 1);
  return { start: Math.min(state.start, Math.max(end, 0)), end, scrollToIndex };
}

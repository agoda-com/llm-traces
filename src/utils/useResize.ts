import { useCallback, useRef, useState } from 'react';

/**
 * Returns a controlled pixel width and a mousedown handler to wire up to a
 * drag-resize handle.  Captures the width at drag-start via a ref so the
 * callback stays stable (min/max deps only).
 */
export function useResize(initialPx: number, min: number, max: number) {
  const [width, setWidth] = useState(initialPx);
  const widthRef = useRef(width);
  widthRef.current = width;

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const resizedElement = e.currentTarget.previousElementSibling as HTMLElement | null;
      const startW = resizedElement?.getBoundingClientRect().width ?? widthRef.current;

      const onMove = (ev: MouseEvent) => {
        setWidth(Math.max(min, Math.min(max, startW + ev.clientX - startX)));
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [min, max]
  );

  return { width, onMouseDown };
}

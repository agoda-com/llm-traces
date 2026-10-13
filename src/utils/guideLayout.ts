/** Width of the "+N" marker that tells how many guides are hidden; `count` is the row's total number of guides. */
export function hiddenLevelsWidth(count: number): number {
  return (String(count).length + 1) * 6 + 4;
}

export interface GuideLayout {
  /** How many guides, counted from the root, are drawn. */
  visible: number;
  /** How many guides are cut off at the right edge of the guide area. */
  hidden: number;
  /** Width of the whole guide area. */
  areaWidth: number;
  /** Width of the part of the area that holds guides; the rest is the marker and chevron. */
  clipWidth: number;
}

/**
 * Decides how many of a row's `count` guides fit in a guide area of at most `areaMax` pixels.
 * Guides start at the left edge and keep their position whatever the depth of the row. When they do not all fit,
 * the ones nearest the name are cut off and `tailWidth` pixels at the right end are kept for the hidden-levels
 * marker and the chevron. `widthAt(i)` is the width of guide i.
 */
export function layoutGuides(count: number, widthAt: (index: number) => number, areaMax: number, tailWidth: number): GuideLayout {
  let used = 0;
  for (let i = 0; i < count && used <= areaMax; i++) {
    used += widthAt(i);
  }
  if (used <= areaMax) {
    return { visible: count, hidden: 0, areaWidth: used, clipWidth: used };
  }
  const areaWidth = Math.max(areaMax, tailWidth);
  const clipWidth = areaWidth - tailWidth;
  let visible = 0;
  used = 0;
  // Only guides that fit completely are drawn, so no guide is cut in half.
  while (visible < count && used + widthAt(visible) <= clipWidth) {
    used += widthAt(visible);
    visible++;
  }
  return { visible, hidden: count - visible, areaWidth, clipWidth };
}

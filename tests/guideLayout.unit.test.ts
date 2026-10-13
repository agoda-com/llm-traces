// Unit tests for guideLayout.ts (how many indent guides fit in the guide area)
// Run with: node --experimental-strip-types tests/guideLayout.unit.test.ts

import { layoutGuides, hiddenLevelsWidth } from '../src/utils/guideLayout.ts';

let passed = 0;
let failed = 0;

function assertDeepEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`  FAIL: ${message} - expected ${e}, got ${a}`);
    failed++;
  } else {
    console.log(`  pass: ${message}`);
    passed++;
  }
}

function describe(name: string, fn: () => void): void {
  console.log(`\n=== ${name} ===`);
  fn();
}

const thick = () => 15;

describe('layoutGuides', () => {
  assertDeepEquals(
    layoutGuides(4, thick, 120, 40),
    { visible: 4, hidden: 0, areaWidth: 60, clipWidth: 60 },
    'guides that fit take exactly their own width',
  );
  assertDeepEquals(
    layoutGuides(8, thick, 120, 40),
    { visible: 8, hidden: 0, areaWidth: 120, clipWidth: 120 },
    'guides that fill the area exactly still fit',
  );
  assertDeepEquals(
    layoutGuides(30, thick, 120, 40),
    { visible: 5, hidden: 25, areaWidth: 120, clipWidth: 80 },
    'too many guides: the ones nearest the name are hidden and room is left for the marker and chevron',
  );
  assertDeepEquals(
    layoutGuides(30, (i) => (i < 2 ? 5 : 15), 120, 40),
    { visible: 6, hidden: 24, areaWidth: 120, clipWidth: 80 },
    'narrow guides take less room, so more fit',
  );
  assertDeepEquals(
    layoutGuides(5, thick, 20, 40),
    { visible: 0, hidden: 5, areaWidth: 40, clipWidth: 0 },
    'an area smaller than the marker and chevron shows only those',
  );
  assertDeepEquals(
    layoutGuides(1000, thick, 120, 40).visible,
    5,
    'a very deep span shows the same guides as any span deeper than the area',
  );
});

describe('guides are never cut in half', () => {
  const widths = (i: number) => (i % 3 === 2 ? 5 : 15);
  const shallow = layoutGuides(12, widths, 120, 40);
  const deep = layoutGuides(400, widths, 120, 40);
  assertDeepEquals(
    layoutGuides(30, () => 15, 112, 40).visible * 15 <= 72,
    true,
    'the drawn guides fit inside the clip box',
  );
  assertDeepEquals(shallow.visible, deep.visible, 'rows of different depth draw the same guides from the root');
  assertDeepEquals(shallow.clipWidth, deep.clipWidth, 'rows of different depth cut off at the same x');
});

describe('hiddenLevelsWidth', () => {
  assertDeepEquals(hiddenLevelsWidth(9) < hiddenLevelsWidth(1000), true, 'more digits need more room');
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) { process.exit(1); }

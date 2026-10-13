// Unit tests for nameColumn.ts (name column width fraction and its persistence)
// Run with: node --experimental-strip-types tests/nameColumn.unit.test.ts

import {
  NAME_COLUMN_DEFAULT,
  NAME_COLUMN_MAX,
  NAME_COLUMN_MIN,
  clampNameColumnFraction,
  loadNameColumnFraction,
  saveNameColumnFraction,
} from '../src/utils/nameColumn.ts';

let passed = 0;
let failed = 0;

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    console.error(`  FAIL: ${message} - expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
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

function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => { data[key] = value; },
  };
}

const throwingStorage = {
  getItem: (): string | null => { throw new Error('storage disabled'); },
  setItem: (): void => { throw new Error('storage disabled'); },
};

describe('limits', () => {
  assertEquals(NAME_COLUMN_DEFAULT, 0.4, 'default is 0.4');
  assertEquals(NAME_COLUMN_MIN, 0.2, 'minimum is 0.2');
  assertEquals(NAME_COLUMN_MAX, 0.85, 'maximum is 0.85');
});

describe('clampNameColumnFraction', () => {
  assertEquals(clampNameColumnFraction(0.5), 0.5, 'a value inside the range is kept');
  assertEquals(clampNameColumnFraction(0.05), 0.2, 'below the minimum is raised');
  assertEquals(clampNameColumnFraction(0.99), 0.85, 'above the maximum is lowered');
  assertEquals(clampNameColumnFraction(Number.NaN), 0.4, 'NaN falls back to the default');
});

describe('loadNameColumnFraction', () => {
  assertEquals(loadNameColumnFraction(fakeStorage()), 0.4, 'nothing stored gives the default');
  const stored = fakeStorage();
  saveNameColumnFraction(0.62, stored);
  assertEquals(loadNameColumnFraction(stored), 0.62, 'a saved value is loaded back');
  saveNameColumnFraction(0.95, stored);
  assertEquals(loadNameColumnFraction(stored), 0.85, 'a saved value outside the range is clamped on load');
  const key = Object.keys(stored.data)[0];
  assertEquals(loadNameColumnFraction(fakeStorage({ [key]: 'wide' })), 0.4, 'garbage gives the default');
  assertEquals(loadNameColumnFraction(throwingStorage), 0.4, 'unavailable storage gives the default');
  assertEquals(loadNameColumnFraction(null), 0.4, 'missing storage gives the default');
});

describe('saveNameColumnFraction', () => {
  const stored = fakeStorage();
  saveNameColumnFraction(0.3, stored);
  assertEquals(Object.values(stored.data)[0], '0.3', 'the fraction is stored as text');
  saveNameColumnFraction(0.3, throwingStorage);
  saveNameColumnFraction(0.3, null);
  assertEquals(true, true, 'unavailable or missing storage does not throw');
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) { process.exit(1); }

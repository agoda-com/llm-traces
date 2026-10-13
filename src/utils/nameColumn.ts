export const NAME_COLUMN_DEFAULT = 0.4;
export const NAME_COLUMN_MIN = 0.2;
export const NAME_COLUMN_MAX = 0.85;

const STORAGE_KEY = 'agoda-llmtraces-app.nameColumnFraction';

type FractionStorage = Pick<Storage, 'getItem' | 'setItem'> | null;

// Reading window.localStorage itself throws when the browser blocks storage.
function browserStorage(): FractionStorage {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function clampNameColumnFraction(value: number): number {
  if (!Number.isFinite(value)) {
    return NAME_COLUMN_DEFAULT;
  }
  return Math.min(NAME_COLUMN_MAX, Math.max(NAME_COLUMN_MIN, value));
}

export function loadNameColumnFraction(storage: FractionStorage = browserStorage()): number {
  try {
    const stored = storage?.getItem(STORAGE_KEY);
    return stored ? clampNameColumnFraction(parseFloat(stored)) : NAME_COLUMN_DEFAULT;
  } catch {
    return NAME_COLUMN_DEFAULT;
  }
}

export function saveNameColumnFraction(fraction: number, storage: FractionStorage = browserStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, String(fraction));
  } catch {
    // The width still applies for this session when storage is unavailable or full.
  }
}

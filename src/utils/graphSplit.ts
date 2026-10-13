/** The share of the span list column that the span tree takes while the agent graph is shown below it. */
export const GRAPH_SPLIT_DEFAULT = 0.5;
export const GRAPH_SPLIT_MIN = 0.2;
export const GRAPH_SPLIT_MAX = 0.8;

const STORAGE_KEY = 'agoda-llmtraces-app.graphSplitFraction';

type FractionStorage = Pick<Storage, 'getItem' | 'setItem'> | null;

// Reading window.localStorage itself throws when the browser blocks storage.
function browserStorage(): FractionStorage {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function clampGraphSplit(value: number): number {
  if (!Number.isFinite(value)) {
    return GRAPH_SPLIT_DEFAULT;
  }
  return Math.min(GRAPH_SPLIT_MAX, Math.max(GRAPH_SPLIT_MIN, value));
}

export function loadGraphSplit(storage: FractionStorage = browserStorage()): number {
  try {
    const stored = storage?.getItem(STORAGE_KEY);
    return stored ? clampGraphSplit(parseFloat(stored)) : GRAPH_SPLIT_DEFAULT;
  } catch {
    return GRAPH_SPLIT_DEFAULT;
  }
}

export function saveGraphSplit(fraction: number, storage: FractionStorage = browserStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, String(fraction));
  } catch {
    // The split still applies for this session when storage is unavailable or full.
  }
}

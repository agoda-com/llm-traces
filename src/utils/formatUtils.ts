/**
 * Format a duration in milliseconds as a human-readable string.
 * Tempo omits durationMs from search results for sub-millisecond traces, so a missing value renders as "<1ms".
 */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || Number.isNaN(ms)) { return '<1ms'; }
  if (ms < 1) { return `${(ms * 1000).toFixed(0)}µs`; }
  if (ms < 1000) { return `${ms.toFixed(0)}ms`; }
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Format a nanosecond timestamp string as a human-readable time.
 * Renders as HH:MM:SS UTC when the timestamp is today, otherwise as "DD Mon HH:MM UTC".
 */
export function formatTime(nanoStr: string): string {
  try {
    const ms = Number(BigInt(nanoStr) / 1000000n);
    const d = new Date(ms);
    const now = new Date();
    const isToday = d.toISOString().slice(0, 10) === now.toISOString().slice(0, 10);
    if (isToday) {
      return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'UTC' }) + ' UTC';
    }
    return (
      d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric', timeZone: 'UTC' }) +
      ' ' +
      d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false }) + ' UTC'
    );
  } catch { return ''; }
}

const MAX_COMPACT_ARRAY_LENGTH = 80;

/**
 * Format an array of primitives on one line, e.g. `["a", "b"]`, so it can wrap between items.
 * Returns undefined for non-arrays, arrays containing objects or arrays, and arrays longer than the limit.
 */
export function formatCompactArray(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.some((item) => typeof item === 'object' && item !== null)) {
    return undefined;
  }
  const compact = `[${value.map((item) => JSON.stringify(item)).join(', ')}]`;
  return compact.length <= MAX_COMPACT_ARRAY_LENGTH ? compact : undefined;
}

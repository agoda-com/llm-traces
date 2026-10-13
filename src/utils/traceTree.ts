import type { PluginSpan } from './tempoClient.ts';

/** Spans by id. When ids repeat, the last span wins, like the parent lookup in tempoClient's buildTree. */
export function indexSpans(flat: PluginSpan[]): Map<string, PluginSpan> {
  const byId = new Map<string, PluginSpan>();
  for (const span of flat) {
    byId.set(span.spanId, span);
  }
  return byId;
}

/**
 * Ids of the nearest `limit` ancestors of `span`, root first. Without a limit this is every ancestor.
 * The walk is bounded by span.depth, so it ends even if parent ids form a loop.
 */
export function getAncestorIds(span: PluginSpan, byId: Map<string, PluginSpan>, limit: number = span.depth): string[] {
  const ancestors: string[] = [];
  let current = span;
  for (let steps = Math.min(limit, span.depth); steps > 0 && current.parentSpanId; steps--) {
    const parent = byId.get(current.parentSpanId);
    if (!parent || parent === current) {
      break;
    }
    ancestors.push(parent.spanId);
    current = parent;
  }
  return ancestors.reverse();
}

/** Spans in display order: pre-order, skipping the descendants of collapsed spans. */
export function getVisibleSpans(roots: PluginSpan[], collapsed: Set<string>): PluginSpan[] {
  const result: PluginSpan[] = [];
  const pending: PluginSpan[] = [];
  for (let i = roots.length - 1; i >= 0; i--) {
    pending.push(roots[i]);
  }
  for (let span = pending.pop(); span; span = pending.pop()) {
    result.push(span);
    if (!collapsed.has(span.spanId)) {
      for (let i = span.children.length - 1; i >= 0; i--) {
        pending.push(span.children[i]);
      }
    }
  }
  return result;
}

/** Ids of the spans that have children. */
export function getParentSpanIds(flat: PluginSpan[]): string[] {
  const ids: string[] = [];
  for (const span of flat) {
    if (span.children.length > 0) {
      ids.push(span.spanId);
    }
  }
  return ids;
}

/**
 * Collapse one more level: hides the deepest expanded parent of every branch.
 * `flat` is the whole trace in pre-order. Returns `collapsed` itself when every parent is already collapsed.
 */
export function collapseOneLevel(flat: PluginSpan[], collapsed: Set<string>): Set<string> {
  if (getParentSpanIds(flat).length === collapsed.size) {
    return collapsed;
  }
  const next = new Set(collapsed);
  let candidate: PluginSpan | undefined;
  for (const span of flat) {
    if (candidate && span.depth <= candidate.depth) {
      next.add(candidate.spanId);
      if (span.children.length > 0) {
        candidate = span;
      }
    } else if (span.children.length > 0 && !next.has(span.spanId)) {
      candidate = span;
    }
  }
  if (candidate) {
    next.add(candidate.spanId);
  }
  return next;
}

/**
 * Expand one more level: opens the shallowest collapsed parent of every branch.
 * `flat` is the whole trace in pre-order. Returns `collapsed` itself when nothing is collapsed.
 */
export function expandOneLevel(flat: PluginSpan[], collapsed: Set<string>): Set<string> {
  if (collapsed.size === 0) {
    return collapsed;
  }
  const next = new Set(collapsed);
  let expandedDepth = -1;
  let expandNext = true;
  for (const span of flat) {
    if (span.depth <= expandedDepth) {
      expandNext = true;
    }
    if (expandNext && next.has(span.spanId)) {
      next.delete(span.spanId);
      expandNext = false;
      expandedDepth = span.depth;
    }
  }
  return next;
}

/** Expands every collapsed ancestor of `spanId`. Returns `collapsed` itself when none is collapsed. */
export function revealSpan(spanId: string, byId: Map<string, PluginSpan>, collapsed: Set<string>): Set<string> {
  const span = byId.get(spanId);
  if (!span || collapsed.size === 0) {
    return collapsed;
  }
  const hidden = getAncestorIds(span, byId).filter((id) => collapsed.has(id));
  if (hidden.length === 0) {
    return collapsed;
  }
  const next = new Set(collapsed);
  hidden.forEach((id) => next.delete(id));
  return next;
}

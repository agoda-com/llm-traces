import type { AgentGraph, GraphEdge } from './agentGraph.ts';
import { START_NODE_ID } from './agentGraph.ts';

const NODE_WIDTH = 168;
const START_WIDTH = 76;
export const NODE_HEIGHT = 42;
const COLUMN_GAP = 36;
const ROW_GAP = 8;
const GRAPH_PADDING = 20;
/** A layer with more nodes than this wraps into several columns instead of growing taller than the view. */
export const MAX_ROWS = 10;
/** How far below the node columns an edge that loops back dips, and the room the graph keeps for it. */
const BACK_EDGE_DROP = 44;
const BACK_EDGE_ROOM = 60;

export interface GraphLayout {
  /** Node ids per layer, in drawing order. Layer 0 holds the Start node. */
  layers: string[][];
  layerOf: Map<string, number>;
  /** Edges that point to the same or an earlier layer, because they close a cycle. */
  backEdges: Set<GraphEdge>;
}

/**
 * Layers nodes by their longest path from Start, ignoring the edges that close a cycle, then orders each layer by
 * the average position of its neighbours to cut down crossings.
 */
export function layoutAgentGraph(graph: AgentGraph): GraphLayout {
  const out = new Map<string, GraphEdge[]>();
  for (const node of graph.nodes) {
    out.set(node.id, []);
  }
  for (const edge of graph.edges) {
    out.get(edge.from)?.push(edge);
  }

  const backEdges = new Set<GraphEdge>();
  const state = new Map<string, 'open' | 'done'>();
  const postorder: string[] = [];
  // Iterative, so a long chain of distinct nodes cannot overflow the stack.
  const dfs = (start: string): void => {
    state.set(start, 'open');
    const stack = [{ id: start, next: 0 }];
    for (let top = stack[stack.length - 1]; top; top = stack[stack.length - 1]) {
      const edges = out.get(top.id) ?? [];
      if (top.next < edges.length) {
        const edge = edges[top.next++];
        const s = state.get(edge.to);
        if (s === 'open') {
          backEdges.add(edge);
        } else if (!s) {
          state.set(edge.to, 'open');
          stack.push({ id: edge.to, next: 0 });
        }
      } else {
        state.set(top.id, 'done');
        postorder.push(top.id);
        stack.pop();
      }
    }
  };
  dfs(START_NODE_ID);
  for (const node of graph.nodes) {
    if (!state.has(node.id)) {
      dfs(node.id);
    }
  }

  const layerOf = new Map<string, number>();
  for (const id of postorder.reverse()) {
    const layer = layerOf.get(id) ?? (id === START_NODE_ID ? 0 : 1);
    layerOf.set(id, layer);
    for (const edge of out.get(id) ?? []) {
      if (!backEdges.has(edge)) {
        layerOf.set(edge.to, Math.max(layerOf.get(edge.to) ?? 0, layer + 1));
      }
    }
  }

  const layers: string[][] = [];
  for (const node of graph.nodes) {
    const layer = layerOf.get(node.id)!;
    (layers[layer] ??= []).push(node.id);
  }
  for (let i = 0; i < layers.length; i++) {
    layers[i] ??= [];
  }

  const neighbours = new Map<string, string[]>();
  for (const node of graph.nodes) {
    neighbours.set(node.id, []);
  }
  for (const edge of graph.edges) {
    if (!backEdges.has(edge) && edge.from !== edge.to) {
      neighbours.get(edge.from)!.push(edge.to);
      neighbours.get(edge.to)!.push(edge.from);
    }
  }
  const position = new Map<string, number>();
  const recordLayer = (ids: string[]) => ids.forEach((id, i) => position.set(id, i));
  layers.forEach(recordLayer);
  const sweep = (layerIndex: number, reference: number) => {
    const barycenter = (id: string, index: number): number => {
      const refs = neighbours.get(id)!.filter((n) => layerOf.get(n) === reference).map((n) => position.get(n)!);
      return refs.length > 0 ? refs.reduce((a, b) => a + b, 0) / refs.length : index;
    };
    layers[layerIndex] = layers[layerIndex]
      .map((id, i) => ({ id, key: barycenter(id, i) }))
      .sort((a, b) => a.key - b.key)
      .map((entry) => entry.id);
    recordLayer(layers[layerIndex]);
  };
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < layers.length; i++) { sweep(i, i - 1); }
    for (let i = layers.length - 2; i >= 1; i--) { sweep(i, i + 1); }
  }

  return { layers, layerOf, backEdges };
}

// ---- Placement ----

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PlacedEdge {
  edge: GraphEdge;
  /** SVG path data. */
  path: string;
  /** Centre of the call-count label. */
  label: Point;
  /** The area the drawn edge and its label stay within. */
  bounds: Rect;
}

export interface PlacedGraph {
  boxes: Map<string, Box>;
  edges: PlacedEdge[];
  width: number;
  height: number;
}

/** Room for the stroke, the arrow head and the call-count label around an edge. */
const grow = (r: Rect): Rect => ({ left: r.left - 16, top: r.top - 16, right: r.right + 16, bottom: r.bottom + 16 });

function placeEdge(edge: GraphEdge, from: Box, to: Box, back: boolean): PlacedEdge {
  if (back) {
    // A cycle-closing edge leaves the bottom of the caller and re-enters the bottom of the callee.
    const x1 = from.x + from.width / 2;
    const x2 = to.x + to.width / 2;
    const bottom = Math.max(from.y, to.y) + NODE_HEIGHT;
    return {
      edge,
      path: `M ${x1} ${from.y + NODE_HEIGHT} C ${x1} ${bottom + BACK_EDGE_DROP}, ${x2} ${bottom + BACK_EDGE_DROP}, ${x2} ${to.y + NODE_HEIGHT}`,
      label: { x: (x1 + x2) / 2, y: bottom + BACK_EDGE_DROP * 0.75 },
      bounds: grow({ left: Math.min(x1, x2), right: Math.max(x1, x2), top: Math.min(from.y, to.y), bottom: bottom + BACK_EDGE_DROP }),
    };
  }
  const x1 = from.x + from.width;
  const y1 = from.y + NODE_HEIGHT / 2;
  const x2 = to.x;
  const y2 = to.y + NODE_HEIGHT / 2;
  const dx = Math.max(40, (x2 - x1) / 2);
  return {
    edge,
    path: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
    // The midpoint of the cubic curve.
    label: { x: (x1 + 3 * (x1 + dx) + 3 * (x2 - dx) + x2) / 8, y: (y1 + y2) / 2 },
    bounds: grow({ left: Math.min(x1, x2), right: Math.max(x1, x2), top: Math.min(y1, y2), bottom: Math.max(y1, y2) }),
  };
}

/**
 * Puts each layer in a column left to right, splitting a layer taller than MAX_ROWS into several columns, and
 * centres every column on the tallest one.
 */
export function placeAgentGraph(graph: AgentGraph, layout: GraphLayout): PlacedGraph {
  const columns: string[][] = [];
  for (const ids of layout.layers) {
    const parts = Math.ceil(ids.length / MAX_ROWS);
    const rows = Math.ceil(ids.length / Math.max(parts, 1));
    for (let part = 0; part < parts; part++) {
      columns.push(ids.slice(part * rows, (part + 1) * rows));
    }
  }
  const heightOf = (rows: number) => rows * NODE_HEIGHT + (rows - 1) * ROW_GAP;
  const tallest = Math.max(...columns.map((c) => c.length), 1);
  const boxes = new Map<string, Box>();
  let x = GRAPH_PADDING;
  for (const ids of columns) {
    const width = ids.length === 1 && ids[0] === START_NODE_ID ? START_WIDTH : NODE_WIDTH;
    const top = GRAPH_PADDING + (heightOf(tallest) - heightOf(ids.length)) / 2;
    ids.forEach((id, i) => boxes.set(id, { x, y: top + i * (NODE_HEIGHT + ROW_GAP), width, height: NODE_HEIGHT }));
    x += width + COLUMN_GAP;
  }
  const edges = graph.edges
    .filter((e) => e.from !== e.to && boxes.has(e.from) && boxes.has(e.to))
    .map((e) => placeEdge(e, boxes.get(e.from)!, boxes.get(e.to)!, layout.backEdges.has(e)));
  return {
    boxes,
    edges,
    width: x - COLUMN_GAP + GRAPH_PADDING,
    height: GRAPH_PADDING * 2 + heightOf(tallest) + (layout.backEdges.size > 0 ? BACK_EDGE_ROOM : 0),
  };
}

const overlaps = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * The part of a placed graph that touches `view`. A trace can have thousands of distinct tools, which is too many
 * elements to keep in the page, so only what is near the visible area is drawn.
 */
export function getGraphInView(graph: AgentGraph, placed: PlacedGraph, view: Rect): { nodeIds: string[]; edges: PlacedEdge[] } {
  const nodeIds = graph.nodes
    .filter((node) => {
      const box = placed.boxes.get(node.id);
      return box && overlaps({ left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height }, view);
    })
    .map((node) => node.id);
  return { nodeIds, edges: placed.edges.filter((e) => overlaps(e.bounds, view)) };
}

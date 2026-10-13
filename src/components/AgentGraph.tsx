import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Icon, useStyles2, useTheme2 } from '@grafana/ui';

import { AgentGraph as AgentGraphModel, GraphEdge, GraphNode, START_NODE_ID, getNodeClickTarget, indexGraphSpans } from '../utils/agentGraph';
import { Box, NODE_HEIGHT, getGraphInView, layoutAgentGraph, placeAgentGraph } from '../utils/agentGraphLayout';
import { getAgentColors, pickAgentColor } from '../utils/agentColors';
import { formatDuration } from '../utils/formatUtils';
import { getSpanKindColor } from '../utils/llmUtils';
import { KindIcon, getKindLabel } from './KindIcon';

const MIN_FIT_SCALE = 0.5;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
const ZOOM_STEP = 1.25;
const ARROW_HEAD = 'M 0 0 L 10 5 L 0 10 z';

const getStyles = (theme: GrafanaTheme2) => ({
  root: css({
    position: 'relative',
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    overscrollBehavior: 'contain',
    background: theme.colors.background.primary,
  }),
  empty: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(1),
    height: '100%',
    padding: theme.spacing(2),
    textAlign: 'center',
    color: theme.colors.text.secondary,
  }),
  zoom: css({
    position: 'sticky',
    top: theme.spacing(1),
    float: 'right',
    marginRight: theme.spacing(1),
    zIndex: 1,
    display: 'flex',
    gap: theme.spacing(0.5),
    alignItems: 'center',
    padding: theme.spacing(0.25),
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  zoomButton: css({
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: theme.colors.text.secondary,
    padding: `0 ${theme.spacing(0.75)}`,
    fontSize: theme.typography.bodySmall.fontSize,
    '&:hover': { color: theme.colors.text.primary },
    '&:focus-visible': { outline: `2px solid ${theme.colors.primary.border}` },
  }),
  node: css({
    boxSizing: 'border-box',
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    gap: 2,
    padding: `0 ${theme.spacing(1)}`,
    borderRadius: 6,
    border: `1px solid ${theme.colors.border.medium}`,
    background: theme.colors.background.secondary,
    color: theme.colors.text.primary,
    cursor: 'pointer',
    overflow: 'hidden',
    '&:hover': { borderColor: theme.colors.text.secondary },
    // Inside the node: the foreignObject around it clips whatever is drawn outside its box.
    '&:focus-visible': { outline: `2px solid ${theme.colors.primary.border}`, outlineOffset: -2 },
  }),
  nodeSelected: css({
    borderColor: theme.colors.primary.border,
    boxShadow: `inset 0 0 0 1px ${theme.colors.primary.border}`,
  }),
  nodeTitle: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    minWidth: 0,
  }),
  nodeName: css({
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  nodeMeta: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    minWidth: 0,
    whiteSpace: 'nowrap',
    fontSize: 11,
    color: theme.colors.text.secondary,
    // Lines the second row up with the name, after the kind icon.
    paddingLeft: 22,
  }),
  nodeNameUnknown: css({
    fontStyle: 'italic',
  }),
  nodeSubtitle: css({
    flex: '0 1 auto',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }),
  nodeStats: css({
    flexShrink: 0,
  }),
  nodePosition: css({
    flexShrink: 0,
    marginLeft: 'auto',
    padding: `0 ${theme.spacing(0.5)}`,
    borderRadius: theme.shape.radius.pill,
    background: theme.colors.primary.transparent,
    color: theme.colors.primary.text,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  nodeError: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
    flexShrink: 0,
    fontSize: 11,
    color: theme.colors.error.text,
  }),
  start: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(0.5),
    width: '100%',
    height: '100%',
    borderRadius: NODE_HEIGHT,
    border: `1px solid ${theme.colors.border.medium}`,
    background: theme.colors.background.canvas,
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
});

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

function describeNode(node: GraphNode, selectedCall: number | undefined): string {
  return [
    node.label,
    getKindLabel(node.kind),
    plural(node.calls.length, 'call'),
    ...(node.modelUnknown ? ['model name not recorded'] : []),
    ...(node.errorCount > 0 ? [`${node.errorCount} failed`] : []),
    ...(selectedCall !== undefined && node.calls.length > 1 ? [`call ${selectedCall + 1} of ${node.calls.length} selected`] : []),
  ].join(', ');
}

function tooltipOf(node: GraphNode, stats: string): string {
  return [
    node.label,
    [node.subtitle, stats].filter(Boolean).join(' · '),
    ...(node.modelUnknown ? ['The spans record no model name, so the node is named after the span.'] : []),
    ...(node.breakdown ?? []).map((b) => `${b.label} ×${b.count}`),
    ...(node.errorCount > 0 ? [`${node.errorCount} failed`] : []),
  ].join('\n');
}

interface AgentGraphProps {
  graph: AgentGraphModel;
  /** The span selected in the span tree or the detail panel; the node that holds it is highlighted. */
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string) => void;
}

export function AgentGraph({ graph, selectedSpanId, onSelectSpan }: AgentGraphProps) {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  const agentColors = useMemo(() => getAgentColors(theme), [theme]);
  const placed = useMemo(() => placeAgentGraph(graph, layoutAgentGraph(graph)), [graph]);
  const locations = useMemo(() => indexGraphSpans(graph), [graph]);
  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState<number | null>(null);

  // Measured before the first paint, so the graph never flashes at full size before it is fitted to the view.
  useLayoutEffect(() => {
    if (!container) {
      return undefined;
    }
    const measure = () => setSize({ width: container.clientWidth, height: container.clientHeight });
    measure();
    // Later changes are deferred to the next frame: the graph's own scrollbars resize the container, which would
    // otherwise loop.
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [container]);

  // Where the container is scrolled to, to draw only the nodes near the visible area.
  const [scrollPosition, setScrollPosition] = useState({ left: 0, top: 0 });
  useEffect(() => {
    if (!container) {
      return undefined;
    }
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setScrollPosition({ left: container.scrollLeft, top: container.scrollTop }));
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      container.removeEventListener('scroll', onScroll);
    };
  }, [container]);

  const selected = selectedSpanId ? locations.get(selectedSpanId) : undefined;
  const selectedNodeId = selected?.nodeId;

  const fitScale = size.width > 0
    ? Math.min(1, Math.max(MIN_FIT_SCALE, Math.min((size.width - 4) / placed.width, (size.height - 4) / placed.height)))
    : 1;
  const scale = zoom ?? fitScale;

  // The visible area plus one more screen on every side, so that scrolling does not show empty space.
  const { nodeIds: visibleNodeIds, edges: visibleEdges } = useMemo(() => {
    const width = size.width / scale;
    const height = size.height / scale;
    const left = scrollPosition.left / scale;
    const top = scrollPosition.top / scale;
    return getGraphInView(graph, placed, { left: left - width, top: top - height, right: left + 2 * width, bottom: top + 2 * height });
  }, [graph, placed, size, scale, scrollPosition]);

  // A selection made in the span tree can be a node that is scrolled out of view.
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  useEffect(() => {
    const at = selectedNodeId ? placed.boxes.get(selectedNodeId) : undefined;
    if (!container || !at) {
      return;
    }
    const s = scaleRef.current;
    const left = at.x * s;
    const top = at.y * s;
    const right = (at.x + at.width) * s;
    const bottom = (at.y + at.height) * s;
    const nextLeft = left < container.scrollLeft ? left : right > container.scrollLeft + container.clientWidth ? right - container.clientWidth : container.scrollLeft;
    const nextTop = top < container.scrollTop ? top : bottom > container.scrollTop + container.clientHeight ? bottom - container.clientHeight : container.scrollTop;
    if (nextLeft !== container.scrollLeft || nextTop !== container.scrollTop) {
      container.scrollTo({ left: nextLeft, top: nextTop });
    }
  }, [selectedNodeId, placed, container]);

  if (graph.nodes.every((n) => n.id === START_NODE_ID)) {
    return (
      <div className={styles.root} data-testid="agent-graph" role="region" aria-label="Agent graph">
        <div className={styles.empty} data-testid="agent-graph-empty">
          <Icon name="info-circle" />
          This trace has no AI spans, so there is no agent graph to draw.
        </div>
      </div>
    );
  }

  const edgeColor = theme.colors.border.strong;
  const activeColor = theme.colors.primary.border;
  const errorColor = theme.colors.error.main;
  const isActive = (e: GraphEdge) => e.to === selectedNodeId;
  const edgeState = (e: GraphEdge): 'active' | 'error' | 'edge' => (isActive(e) ? 'active' : e.errorCount > 0 ? 'error' : 'edge');
  const stateColors = { edge: edgeColor, active: activeColor, error: errorColor };

  const renderNode = (node: GraphNode, at: Box) => {
    if (node.id === START_NODE_ID) {
      return (
        <foreignObject key={node.id} x={at.x} y={at.y} width={at.width} height={at.height}>
          <div className={styles.start} data-testid="agent-graph-start">
            <Icon name="play" size="sm" />
            Start
          </div>
        </foreignObject>
      );
    }
    const isSelected = node.id === selectedNodeId;
    const agentColor = node.kind === 'AGENT' && node.colorIndex !== undefined ? pickAgentColor(agentColors, node.colorIndex) : undefined;
    const accent = agentColor?.solid ?? getSpanKindColor(node.kind);
    const stats = `×${node.calls.length} · ${formatDuration(node.totalMs)}`;
    const select = () => {
      const target = getNodeClickTarget(node, selected);
      if (target) {
        onSelectSpan(target);
      }
    };
    return (
      <foreignObject key={node.id} x={at.x} y={at.y} width={at.width} height={at.height}>
        <div
          className={isSelected ? `${styles.node} ${styles.nodeSelected}` : styles.node}
          style={{
            borderLeft: `4px solid ${accent}`,
            ...(agentColor ? { background: agentColor.tint, borderColor: isSelected ? undefined : agentColor.solid, borderLeftColor: agentColor.solid } : {}),
          }}
          role="button"
          tabIndex={0}
          aria-pressed={isSelected}
          aria-label={describeNode(node, isSelected ? selected?.call : undefined)}
          title={tooltipOf(node, stats)}
          data-testid="agent-graph-node"
          data-node-id={node.id}
          onClick={select}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              select();
            }
          }}
        >
          <div className={styles.nodeTitle}>
            <KindIcon kind={node.kind} />
            <span className={node.modelUnknown ? `${styles.nodeName} ${styles.nodeNameUnknown}` : styles.nodeName} data-graph-label={node.label}>{node.label}</span>
            {node.errorCount > 0 && (
              <span className={styles.nodeError} data-testid="agent-graph-node-error">
                <Icon name="exclamation-triangle" size="sm" />
                {node.errorCount}
              </span>
            )}
          </div>
          <div className={styles.nodeMeta}>
            {node.subtitle && <span className={styles.nodeSubtitle}>{node.subtitle} ·</span>}
            <span className={styles.nodeStats} data-graph-label={stats}>{stats}</span>
            {isSelected && selected && node.calls.length > 1 && (
              <span className={styles.nodePosition} data-testid="agent-graph-node-position">{`${selected.call + 1}/${node.calls.length}`}</span>
            )}
          </div>
        </div>
      </foreignObject>
    );
  };

  return (
    <div className={styles.root} ref={setContainer} data-testid="agent-graph" role="region" aria-label="Agent graph">
      <div className={styles.zoom}>
        <button className={styles.zoomButton} onClick={() => setZoom(Math.max(MIN_ZOOM, scale / ZOOM_STEP))} aria-label="Zoom out" title="Zoom out">−</button>
        <span>{Math.round(scale * 100)}%</span>
        <button className={styles.zoomButton} onClick={() => setZoom(Math.min(MAX_ZOOM, scale * ZOOM_STEP))} aria-label="Zoom in" title="Zoom in">+</button>
        <button className={styles.zoomButton} onClick={() => setZoom(null)} aria-label="Fit graph to view" title="Fit graph to view">Fit</button>
      </div>
      <svg width={placed.width * scale} height={placed.height * scale} viewBox={`0 0 ${placed.width} ${placed.height}`} role="group" aria-label="Call graph" style={{ display: 'block' }}>
        <defs>
          {Object.entries(stateColors).map(([state, color]) => (
            <marker key={state} id={`agent-graph-arrow-${state}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d={ARROW_HEAD} fill={color} />
            </marker>
          ))}
        </defs>
        {visibleEdges.map(({ edge, path, label }) => {
          const state = edgeState(edge);
          const color = stateColors[state];
          return (
            <g key={`${edge.from}>${edge.to}`} data-testid="agent-graph-edge" data-from={edge.from} data-to={edge.to} data-active={isActive(edge)}>
              <title>{`×${edge.count}, ${formatDuration(edge.totalMs)}${edge.errorCount > 0 ? `, ${edge.errorCount} failed` : ''}`}</title>
              <path d={path} fill="none" stroke={color} strokeWidth={state === 'active' ? 2 : 1.5} markerEnd={`url(#agent-graph-arrow-${state})`} />
              {edge.count > 1 && (
                <>
                  <rect x={label.x - 15} y={label.y - 9} width={30} height={18} rx={9} fill={theme.colors.background.primary} stroke={color} strokeWidth={1} />
                  <text x={label.x} y={label.y + 4} textAnchor="middle" fontSize={11} fill={edge.errorCount > 0 ? errorColor : theme.colors.text.secondary}>
                    {`×${edge.count}`}
                  </text>
                </>
              )}
            </g>
          );
        })}
        {visibleNodeIds.map((id) => renderNode(nodeById.get(id)!, placed.boxes.get(id)!))}
      </svg>
    </div>
  );
}

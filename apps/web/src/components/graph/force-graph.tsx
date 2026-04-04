'use client';

import { useEffect, useRef, useCallback } from 'react';
import * as d3 from 'd3';

export interface ForceGraphNode {
  id: string;
  label: string;
  type: string;
  grNo?: string | null;
  court?: string | null;
  decisionDate?: string | null;
  citationCount?: number;
}

export interface ForceGraphEdge {
  source: string;
  target: string;
  label?: string;
  type?: string;
}

interface SimNode extends d3.SimulationNodeDatum, ForceGraphNode {}
interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  label?: string;
  type?: string;
}

interface ForceGraphProps {
  nodes: ForceGraphNode[];
  edges: ForceGraphEdge[];
  onNodeClick?: (nodeId: string) => void;
  width?: number;
  height?: number;
  centerNodeId?: string;
}

const NODE_COLORS: Record<string, string> = {
  supreme_court_decision: '#3b82f6',
  court_of_appeals_decision: '#8b5cf6',
  statute: '#10b981',
  executive_order: '#f59e0b',
  presidential_decree: '#ef4444',
  republic_act: '#06b6d4',
  codal: '#14b8a6',
  default: '#6b7280',
};

const EDGE_COLORS: Record<string, string> = {
  cites: '#94a3b8',
  applies: '#22c55e',
  overrules: '#ef4444',
  distinguishes: '#a855f7',
  interprets: '#3b82f6',
  modifies: '#f59e0b',
  default: '#d1d5db',
};

export function ForceGraph({
  nodes,
  edges,
  onNodeClick,
  width = 800,
  height = 600,
  centerNodeId,
}: ForceGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);

  const getNodeColor = useCallback((type: string) => NODE_COLORS[type] ?? NODE_COLORS['default'], []);
  const getEdgeColor = useCallback((type?: string) => (type ? EDGE_COLORS[type] ?? EDGE_COLORS['default'] : EDGE_COLORS['default']), []);

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const simNodes: SimNode[] = nodes.map((n) => ({ ...n }));
    const simLinks: SimLink[] = edges.map((e) => ({
      source: e.source,
      target: e.target,
      label: e.label,
      type: e.type,
    }));

    // Arrow marker defs
    const defs = svg.append('defs');
    const uniqueEdgeTypes = [...new Set(edges.map((e) => e.type ?? 'default'))];
    uniqueEdgeTypes.forEach((type) => {
      defs
        .append('marker')
        .attr('id', `arrow-${type}`)
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 20)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', getEdgeColor(type));
    });

    // Container for zoom
    const container = svg.append('g');

    // Zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        container.attr('transform', event.transform);
      });
    svg.call(zoom);

    // Links
    const link = container
      .append('g')
      .selectAll<SVGLineElement, SimLink>('line')
      .data(simLinks)
      .join('line')
      .attr('stroke', (d) => getEdgeColor(d.type))
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.6)
      .attr('marker-end', (d) => `url(#arrow-${d.type ?? 'default'})`);

    // Edge labels
    const edgeLabel = container
      .append('g')
      .selectAll<SVGTextElement, SimLink>('text')
      .data(simLinks.filter((d) => d.label))
      .join('text')
      .text((d) => d.label ?? '')
      .attr('font-size', 9)
      .attr('fill', '#9ca3af')
      .attr('text-anchor', 'middle')
      .attr('dy', -4);

    // Nodes
    const node = container
      .append('g')
      .selectAll<SVGCircleElement, SimNode>('circle')
      .data(simNodes)
      .join('circle')
      .attr('r', (d) => {
        const base = 8;
        const extra = Math.min((d.citationCount ?? 0) * 0.5, 8);
        return base + extra;
      })
      .attr('fill', (d) => getNodeColor(d.type))
      .attr('stroke', (d) => (d.id === centerNodeId ? '#000' : '#fff'))
      .attr('stroke-width', (d) => (d.id === centerNodeId ? 3 : 1.5))
      .attr('cursor', 'pointer')
      .on('click', (_, d) => onNodeClick?.(d.id));

    // Node labels
    const nodeLabel = container
      .append('g')
      .selectAll<SVGTextElement, SimNode>('text')
      .data(simNodes)
      .join('text')
      .text((d) => d.grNo ?? d.label.slice(0, 30))
      .attr('font-size', 10)
      .attr('fill', '#374151')
      .attr('dx', 12)
      .attr('dy', 4);

    // Tooltip
    const tooltip = d3
      .select('body')
      .append('div')
      .attr('class', 'force-graph-tooltip')
      .style('position', 'absolute')
      .style('padding', '6px 10px')
      .style('background', '#1f2937')
      .style('color', '#f9fafb')
      .style('border-radius', '4px')
      .style('font-size', '11px')
      .style('pointer-events', 'none')
      .style('opacity', '0')
      .style('z-index', '50')
      .style('max-width', '250px');

    node
      .on('mouseenter', (event, d) => {
        const lines = [d.label];
        if (d.grNo) lines.push(`GR: ${d.grNo}`);
        if (d.court) lines.push(`Court: ${d.court}`);
        if (d.decisionDate) lines.push(`Date: ${new Date(d.decisionDate).toLocaleDateString()}`);
        lines.push(`Type: ${d.type.replace(/_/g, ' ')}`);

        tooltip
          .html(lines.join('<br/>'))
          .style('left', `${event.pageX + 12}px`)
          .style('top', `${event.pageY - 12}px`)
          .style('opacity', '1');
      })
      .on('mousemove', (event) => {
        tooltip
          .style('left', `${event.pageX + 12}px`)
          .style('top', `${event.pageY - 12}px`);
      })
      .on('mouseleave', () => {
        tooltip.style('opacity', '0');
      });

    // Drag behavior
    const drag = d3
      .drag<SVGCircleElement, SimNode>()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
    node.call(drag);

    // Force simulation
    const simulation = d3
      .forceSimulation(simNodes)
      .force(
        'link',
        d3.forceLink<SimNode, SimLink>(simLinks).id((d) => d.id).distance(120),
      )
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(30))
      .on('tick', () => {
        link
          .attr('x1', (d) => (d.source as SimNode).x ?? 0)
          .attr('y1', (d) => (d.source as SimNode).y ?? 0)
          .attr('x2', (d) => (d.target as SimNode).x ?? 0)
          .attr('y2', (d) => (d.target as SimNode).y ?? 0);

        edgeLabel
          .attr('x', (d) => (((d.source as SimNode).x ?? 0) + ((d.target as SimNode).x ?? 0)) / 2)
          .attr('y', (d) => (((d.source as SimNode).y ?? 0) + ((d.target as SimNode).y ?? 0)) / 2);

        node
          .attr('cx', (d) => d.x ?? 0)
          .attr('cy', (d) => d.y ?? 0);

        nodeLabel
          .attr('x', (d) => d.x ?? 0)
          .attr('y', (d) => d.y ?? 0);
      });

    simulationRef.current = simulation;

    return () => {
      simulation.stop();
      tooltip.remove();
    };
  }, [nodes, edges, width, height, centerNodeId, onNodeClick, getNodeColor, getEdgeColor]);

  if (nodes.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed border-gray-300 bg-gray-50 text-sm text-gray-400"
        style={{ width, height }}
      >
        Enter a document ID to visualize the citation graph
      </div>
    );
  }

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      className="rounded-md border border-gray-200 bg-white"
    />
  );
}

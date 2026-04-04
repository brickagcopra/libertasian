'use client';

import { useEffect, useRef } from 'react';
import * as d3 from 'd3';

export interface BarChartItem {
  label: string;
  value: number;
  color?: string;
}

interface BarChartProps {
  data: BarChartItem[];
  width?: number;
  height?: number;
  className?: string;
}

export function BarChart({ data, width = 500, height = 300, className }: BarChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || data.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const margin = { top: 10, right: 20, bottom: 10, left: 120 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = svg
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const maxVal = d3.max(data, (d) => d.value) ?? 1;

    const yScale = d3
      .scaleBand<string>()
      .domain(data.map((d) => d.label))
      .range([0, innerHeight])
      .padding(0.25);

    const xScale = d3
      .scaleLinear()
      .domain([0, maxVal])
      .range([0, innerWidth]);

    const defaultColor = '#6366f1';

    // Bars
    g.selectAll('rect')
      .data(data)
      .join('rect')
      .attr('y', (d) => yScale(d.label) ?? 0)
      .attr('height', yScale.bandwidth())
      .attr('x', 0)
      .attr('width', (d) => xScale(d.value))
      .attr('fill', (d) => d.color ?? defaultColor)
      .attr('rx', 3);

    // Value labels
    g.selectAll('.val-label')
      .data(data)
      .join('text')
      .attr('class', 'val-label')
      .attr('x', (d) => xScale(d.value) + 4)
      .attr('y', (d) => (yScale(d.label) ?? 0) + yScale.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('font-size', '11px')
      .attr('fill', 'currentColor')
      .text((d) => d.value.toLocaleString());

    // Y-axis labels
    g.selectAll('.y-label')
      .data(data)
      .join('text')
      .attr('class', 'y-label')
      .attr('x', -6)
      .attr('y', (d) => (yScale(d.label) ?? 0) + yScale.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .attr('font-size', '11px')
      .attr('fill', 'currentColor')
      .text((d) => d.label.length > 18 ? d.label.slice(0, 16) + '...' : d.label);
  }, [data, width, height]);

  return <svg ref={svgRef} className={className} />;
}

'use client';

import { useEffect, useRef } from 'react';
import * as d3 from 'd3';

export interface HeatmapCell {
  row: string;
  col: string;
  value: number;
}

interface HeatmapProps {
  data: HeatmapCell[];
  width?: number;
  height?: number;
  className?: string;
}

export function Heatmap({ data, width = 600, height = 400, className }: HeatmapProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || data.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const rows = [...new Set(data.map((d) => d.row))];
    const cols = [...new Set(data.map((d) => d.col))];

    const margin = { top: 60, right: 20, bottom: 10, left: 120 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = svg
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const xScale = d3
      .scaleBand<string>()
      .domain(cols)
      .range([0, innerWidth])
      .padding(0.05);

    const yScale = d3
      .scaleBand<string>()
      .domain(rows)
      .range([0, innerHeight])
      .padding(0.05);

    const maxVal = d3.max(data, (d) => d.value) ?? 1;
    const colorScale = d3
      .scaleSequential(d3.interpolateBlues)
      .domain([0, maxVal]);

    // Build lookup map
    const valueMap = new Map(data.map((d) => [`${d.row}|${d.col}`, d.value]));

    // Cells
    for (const row of rows) {
      for (const col of cols) {
        const val = valueMap.get(`${row}|${col}`) ?? 0;
        g.append('rect')
          .attr('x', xScale(col) ?? 0)
          .attr('y', yScale(row) ?? 0)
          .attr('width', xScale.bandwidth())
          .attr('height', yScale.bandwidth())
          .attr('fill', val > 0 ? colorScale(val) : '#f1f5f9')
          .attr('rx', 2);

        if (val > 0) {
          g.append('text')
            .attr('x', (xScale(col) ?? 0) + xScale.bandwidth() / 2)
            .attr('y', (yScale(row) ?? 0) + yScale.bandwidth() / 2)
            .attr('dy', '0.35em')
            .attr('text-anchor', 'middle')
            .attr('font-size', '10px')
            .attr('fill', val > maxVal * 0.6 ? '#fff' : '#334155')
            .text(val);
        }
      }
    }

    // Row labels
    g.selectAll('.row-label')
      .data(rows)
      .join('text')
      .attr('class', 'row-label')
      .attr('x', -6)
      .attr('y', (d) => (yScale(d) ?? 0) + yScale.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .attr('font-size', '10px')
      .attr('fill', 'currentColor')
      .text((d) => d.length > 16 ? d.slice(0, 14) + '...' : d);

    // Column labels
    g.selectAll('.col-label')
      .data(cols)
      .join('text')
      .attr('class', 'col-label')
      .attr('x', (d) => (xScale(d) ?? 0) + xScale.bandwidth() / 2)
      .attr('y', -8)
      .attr('text-anchor', 'middle')
      .attr('font-size', '10px')
      .attr('fill', 'currentColor')
      .attr('transform', (d) => {
        const x = (xScale(d) ?? 0) + xScale.bandwidth() / 2;
        return `rotate(-45, ${x}, -8)`;
      })
      .text((d) => d.length > 12 ? d.slice(0, 10) + '...' : d);
  }, [data, width, height]);

  return <svg ref={svgRef} className={className} />;
}

'use client';

import { useEffect, useRef } from 'react';
import * as d3 from 'd3';

export interface LineChartPoint {
  date: Date;
  value: number;
  cumulative?: number;
}

interface LineChartProps {
  data: LineChartPoint[];
  width?: number;
  height?: number;
  showCumulative?: boolean;
  className?: string;
}

export function LineChart({
  data,
  width = 600,
  height = 300,
  showCumulative = false,
  className,
}: LineChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || data.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const margin = { top: 20, right: showCumulative ? 60 : 20, bottom: 40, left: 50 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = svg
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Scales
    const xScale = d3
      .scaleTime()
      .domain(d3.extent(data, (d) => d.date) as [Date, Date])
      .range([0, innerWidth]);

    const yMax = d3.max(data, (d) => d.value) ?? 1;
    const yScale = d3
      .scaleLinear()
      .domain([0, yMax * 1.1])
      .range([innerHeight, 0]);

    // X axis
    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale).ticks(6).tickFormat(d3.timeFormat('%b %d') as (d: d3.NumberValue, i: number) => string))
      .attr('font-size', '10px');

    // Y axis (left)
    g.append('g')
      .call(d3.axisLeft(yScale).ticks(5))
      .attr('font-size', '10px');

    // Primary line (document count per period)
    const line = d3
      .line<LineChartPoint>()
      .x((d) => xScale(d.date))
      .y((d) => yScale(d.value))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', '#6366f1')
      .attr('stroke-width', 2)
      .attr('d', line);

    // Dots
    g.selectAll('.dot')
      .data(data)
      .join('circle')
      .attr('class', 'dot')
      .attr('cx', (d) => xScale(d.date))
      .attr('cy', (d) => yScale(d.value))
      .attr('r', 3)
      .attr('fill', '#6366f1');

    // Cumulative line (right Y axis)
    if (showCumulative && data.some((d) => d.cumulative !== undefined)) {
      const cMax = d3.max(data, (d) => d.cumulative ?? 0) ?? 1;
      const yCumScale = d3
        .scaleLinear()
        .domain([0, cMax * 1.1])
        .range([innerHeight, 0]);

      // Right axis
      g.append('g')
        .attr('transform', `translate(${innerWidth},0)`)
        .call(d3.axisRight(yCumScale).ticks(5))
        .attr('font-size', '10px')
        .selectAll('text')
        .attr('fill', '#f59e0b');

      const cumLine = d3
        .line<LineChartPoint>()
        .x((d) => xScale(d.date))
        .y((d) => yCumScale(d.cumulative ?? 0))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(data)
        .attr('fill', 'none')
        .attr('stroke', '#f59e0b')
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '4,3')
        .attr('d', cumLine);
    }
  }, [data, width, height, showCumulative]);

  return <svg ref={svgRef} className={className} />;
}

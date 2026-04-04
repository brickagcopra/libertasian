'use client';

import { useEffect, useRef } from 'react';
import * as d3 from 'd3';

interface RadialProgressProps {
  value: number; // 0-1
  label: string;
  sublabel?: string;
  size?: number;
  className?: string;
}

export function RadialProgress({
  value,
  label,
  sublabel,
  size = 100,
  className,
}: RadialProgressProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const radius = size / 2 - 8;
    const thickness = 8;
    const clamped = Math.min(1, Math.max(0, value));

    const g = svg
      .attr('width', size)
      .attr('height', size)
      .append('g')
      .attr('transform', `translate(${size / 2},${size / 2})`);

    // Background arc
    const bgArc = d3
      .arc<unknown>()
      .innerRadius(radius - thickness)
      .outerRadius(radius)
      .startAngle(0)
      .endAngle(2 * Math.PI);

    g.append('path')
      .attr('d', bgArc({}) as string)
      .attr('fill', '#e2e8f0');

    // Foreground arc
    const color = clamped >= 0.7 ? '#22c55e' : clamped >= 0.4 ? '#f59e0b' : '#ef4444';

    const fgArc = d3
      .arc<unknown>()
      .innerRadius(radius - thickness)
      .outerRadius(radius)
      .startAngle(0)
      .endAngle(clamped * 2 * Math.PI)
      .cornerRadius(thickness / 2);

    g.append('path')
      .attr('d', fgArc({}) as string)
      .attr('fill', color);

    // Center text (percentage)
    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '-0.1em')
      .attr('font-size', `${Math.round(size / 5)}px`)
      .attr('font-weight', '700')
      .attr('fill', 'currentColor')
      .text(`${Math.round(clamped * 100)}%`);

    // Sublabel inside ring
    if (sublabel) {
      g.append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', '1.2em')
        .attr('font-size', '10px')
        .attr('fill', '#64748b')
        .text(sublabel);
    }
  }, [value, sublabel, size]);

  return (
    <div className={`flex flex-col items-center ${className ?? ''}`}>
      <svg ref={svgRef} />
      <span className="mt-1 text-xs font-medium text-center">{label}</span>
    </div>
  );
}

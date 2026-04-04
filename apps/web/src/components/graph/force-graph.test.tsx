import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock d3 with chainable API
const mockSimulation = {
  force: vi.fn().mockReturnThis(),
  on: vi.fn().mockReturnThis(),
  stop: vi.fn(),
  alphaTarget: vi.fn().mockReturnThis(),
  restart: vi.fn(),
};

const mockSelection = {
  append: vi.fn().mockReturnThis(),
  selectAll: vi.fn().mockReturnThis(),
  data: vi.fn().mockReturnThis(),
  join: vi.fn().mockReturnThis(),
  attr: vi.fn().mockReturnThis(),
  style: vi.fn().mockReturnThis(),
  text: vi.fn().mockReturnThis(),
  html: vi.fn().mockReturnThis(),
  filter: vi.fn().mockReturnThis(),
  on: vi.fn().mockReturnThis(),
  call: vi.fn().mockReturnThis(),
  remove: vi.fn().mockReturnThis(),
};

vi.mock('d3', () => ({
  select: vi.fn(() => mockSelection),
  selectAll: vi.fn(() => mockSelection),
  forceSimulation: vi.fn(() => mockSimulation),
  forceLink: vi.fn(() => ({
    id: vi.fn().mockReturnThis(),
    distance: vi.fn().mockReturnThis(),
  })),
  forceManyBody: vi.fn(() => ({ strength: vi.fn().mockReturnThis() })),
  forceCenter: vi.fn(),
  forceCollide: vi.fn(() => ({ radius: vi.fn().mockReturnThis() })),
  zoom: vi.fn(() => ({
    scaleExtent: vi.fn().mockReturnThis(),
    on: vi.fn().mockReturnThis(),
  })),
  drag: vi.fn(() => ({
    on: vi.fn().mockReturnThis(),
  })),
}));

import { ForceGraph, type ForceGraphNode, type ForceGraphEdge } from './force-graph';

const mockNodes: ForceGraphNode[] = [
  {
    id: 'doc-1',
    label: 'People v. Marti',
    type: 'supreme_court_decision',
    grNo: 'G.R. No. 81561',
    court: 'Supreme Court',
    decisionDate: '1991-01-18',
    citationCount: 10,
  },
  {
    id: 'doc-2',
    label: 'Republic Act No. 9165',
    type: 'republic_act',
    grNo: null,
    court: null,
    decisionDate: '2002-06-07',
    citationCount: 25,
  },
];

const mockEdges: ForceGraphEdge[] = [
  { source: 'doc-1', target: 'doc-2', label: 'interprets', type: 'interprets' },
];

describe('ForceGraph', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows empty state when no nodes', () => {
    render(<ForceGraph nodes={[]} edges={[]} />);
    expect(
      screen.getByText('Enter a document ID to visualize the citation graph'),
    ).toBeTruthy();
  });

  it('renders SVG when nodes are provided', () => {
    const { container } = render(
      <ForceGraph nodes={mockNodes} edges={mockEdges} />,
    );
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('applies default width and height to SVG', () => {
    const { container } = render(
      <ForceGraph nodes={mockNodes} edges={mockEdges} />,
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('800');
    expect(svg?.getAttribute('height')).toBe('600');
  });

  it('applies custom width and height', () => {
    const { container } = render(
      <ForceGraph nodes={mockNodes} edges={mockEdges} width={1024} height={768} />,
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('1024');
    expect(svg?.getAttribute('height')).toBe('768');
  });

  it('applies custom dimensions to empty state', () => {
    const { container } = render(
      <ForceGraph nodes={[]} edges={[]} width={500} height={400} />,
    );
    const emptyDiv = container.firstElementChild as HTMLElement;
    expect(emptyDiv.style.width).toBe('500px');
    expect(emptyDiv.style.height).toBe('400px');
  });

  it('does not render SVG when nodes empty', () => {
    const { container } = render(<ForceGraph nodes={[]} edges={[]} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('initializes d3 simulation when nodes provided', async () => {
    const d3 = await import('d3');
    render(<ForceGraph nodes={mockNodes} edges={mockEdges} />);
    expect(d3.forceSimulation).toHaveBeenCalled();
  });

  it('passes onNodeClick prop without error', () => {
    const onClick = vi.fn();
    const { container } = render(
      <ForceGraph nodes={mockNodes} edges={mockEdges} onNodeClick={onClick} />,
    );
    expect(container.querySelector('svg')).toBeTruthy();
  });
});

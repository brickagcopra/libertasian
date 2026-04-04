'use client';

import Link from 'next/link';

export interface TrailNode {
  id: string;
  title: string;
  grNo?: string | null;
  court?: string | null;
  decisionDate?: string | null;
  documentType: string;
}

export interface TrailEdge {
  fromId: string;
  toId: string;
  citationType?: string;
}

interface PrecedentTrailProps {
  nodes: TrailNode[];
  edges: TrailEdge[];
  centerDocumentId?: string;
}

const TYPE_COLORS: Record<string, string> = {
  supreme_court_decision: 'border-blue-400 bg-blue-50',
  court_of_appeals_decision: 'border-purple-400 bg-purple-50',
  statute: 'border-green-400 bg-green-50',
  republic_act: 'border-cyan-400 bg-cyan-50',
  executive_order: 'border-amber-400 bg-amber-50',
  presidential_decree: 'border-red-400 bg-red-50',
  codal: 'border-teal-400 bg-teal-50',
};

export function PrecedentTrail({ nodes, edges, centerDocumentId }: PrecedentTrailProps) {
  // Sort nodes by decision date (oldest first), undated at the end
  const sorted = [...nodes].sort((a, b) => {
    if (!a.decisionDate && !b.decisionDate) return 0;
    if (!a.decisionDate) return 1;
    if (!b.decisionDate) return -1;
    return new Date(a.decisionDate).getTime() - new Date(b.decisionDate).getTime();
  });

  // Build a set of connected pairs for drawing connecting lines
  const edgeSet = new Set(edges.map((e) => `${e.fromId}-${e.toId}`));

  if (sorted.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-400">
        No precedent trail data available
      </div>
    );
  }

  return (
    <div className="relative space-y-0">
      {sorted.map((node, index) => {
        const isCenter = node.id === centerDocumentId;
        const nextNode = sorted[index + 1];
        const hasConnectionToNext = nextNode
          ? edgeSet.has(`${node.id}-${nextNode.id}`) || edgeSet.has(`${nextNode.id}-${node.id}`)
          : false;

        // Find the edge type for the connection to the next node
        const edgeToNext = nextNode
          ? edges.find(
              (e) =>
                (e.fromId === node.id && e.toId === nextNode.id) ||
                (e.fromId === nextNode.id && e.toId === node.id),
            )
          : undefined;

        const cardColor = TYPE_COLORS[node.documentType] ?? 'border-gray-300 bg-gray-50';

        return (
          <div key={node.id} className="relative flex gap-4">
            {/* Timeline left column */}
            <div className="flex w-24 shrink-0 flex-col items-end pt-3 text-right">
              {node.decisionDate ? (
                <span className="text-xs font-medium text-gray-500">
                  {new Date(node.decisionDate).toLocaleDateString('en-PH', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              ) : (
                <span className="text-xs text-gray-400">No date</span>
              )}
            </div>

            {/* Timeline line + dot */}
            <div className="relative flex flex-col items-center">
              <div
                className={`z-10 h-3 w-3 rounded-full ${
                  isCenter ? 'bg-gray-900 ring-2 ring-gray-400' : 'bg-gray-400'
                }`}
                style={{ marginTop: '14px' }}
              />
              {index < sorted.length - 1 && (
                <div
                  className={`w-0.5 flex-1 ${
                    hasConnectionToNext ? 'bg-gray-400' : 'bg-gray-200'
                  }`}
                  style={{ minHeight: '16px' }}
                />
              )}
            </div>

            {/* Card right column */}
            <div className="flex-1 pb-4">
              <Link
                href={`/reader/${node.id}`}
                className={`block rounded-md border-l-4 p-3 transition-opacity hover:opacity-80 ${cardColor} ${
                  isCenter ? 'ring-2 ring-gray-900' : ''
                }`}
              >
                <p className={`text-sm font-medium ${isCenter ? 'text-gray-900' : 'text-gray-700'}`}>
                  {node.title}
                </p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {node.grNo && (
                    <span className="text-xs text-gray-500">{node.grNo}</span>
                  )}
                  {node.court && (
                    <span className="text-xs text-gray-500">{node.court}</span>
                  )}
                  <span className="text-xs text-gray-400">
                    {node.documentType.replace(/_/g, ' ')}
                  </span>
                </div>
              </Link>

              {/* Connection label */}
              {edgeToNext && (
                <div className="ml-2 mt-1 text-xs text-gray-400">
                  {edgeToNext.citationType ? `${edgeToNext.citationType} →` : 'cites →'}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

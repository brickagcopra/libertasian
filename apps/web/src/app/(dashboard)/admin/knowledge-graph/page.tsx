'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Search, Wand2, Plus, Pencil, Trash2, Sparkles } from 'lucide-react';

import {
  useGraphNetwork,
  useUnresolvedCitations,
  useTriggerCitationResolution,
  useResolveCitation,
  useListCaseCodalLinks,
  useCreateCaseCodalLink,
  useUpdateCaseCodalLink,
  useDeleteCaseCodalLink,
  useSuggestCaseCodalLinks,
} from '@/features/admin/hooks/use-admin';
import type { UnresolvedCitationItem, CaseCodalLinkItem, CaseCodalSuggestion } from '@/features/admin/types';
import type { ForceGraphNode, ForceGraphEdge } from '@/components/graph/force-graph';
import type { TrailNode, TrailEdge } from '@/components/graph/precedent-trail';

const ForceGraph = dynamic(
  () => import('@/components/graph/force-graph').then((mod) => mod.ForceGraph),
  { ssr: false, loading: () => <div className="flex h-[500px] items-center justify-center text-muted-foreground">Loading graph...</div> },
);
const PrecedentTrail = dynamic(
  () => import('@/components/graph/precedent-trail').then((mod) => mod.PrecedentTrail),
  { ssr: false, loading: () => <div className="flex h-[300px] items-center justify-center text-muted-foreground">Loading trail...</div> },
);
import { AdminListSkeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';

export default function KnowledgeGraphPage() {
  const [documentId, setDocumentId] = useState('');
  const [activeDocId, setActiveDocId] = useState('');
  const [depth, setDepth] = useState(2);

  const { data: networkData, isLoading: networkLoading, error: networkError } = useGraphNetwork(
    activeDocId,
    depth,
  );

  const handleSearch = () => {
    if (documentId.trim()) {
      setActiveDocId(documentId.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  // Transform API data into ForceGraph format
  const graphNodes: ForceGraphNode[] = (networkData?.nodes ?? []).map((n) => ({
    id: n.id,
    label: n.title,
    type: n.documentType,
    grNo: n.grNo,
    court: n.court,
    decisionDate: n.decisionDate,
    citationCount: (networkData?.edges ?? []).filter(
      (e) => e.fromDocumentId === n.id || e.toDocumentId === n.id,
    ).length,
  }));

  const graphEdges: ForceGraphEdge[] = (networkData?.edges ?? []).map((e) => ({
    source: e.fromDocumentId,
    target: e.toDocumentId,
    label: e.citationType,
    type: e.citationType,
  }));

  // Transform for PrecedentTrail
  const trailNodes: TrailNode[] = (networkData?.nodes ?? []).map((n) => ({
    id: n.id,
    title: n.title,
    grNo: n.grNo,
    court: n.court,
    decisionDate: n.decisionDate,
    documentType: n.documentType,
  }));

  const trailEdges: TrailEdge[] = (networkData?.edges ?? []).map((e) => ({
    fromId: e.fromDocumentId,
    toId: e.toDocumentId,
    citationType: e.citationType,
  }));

  const handleNodeClick = (nodeId: string) => {
    setDocumentId(nodeId);
    setActiveDocId(nodeId);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Knowledge Graph</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Visualize citation networks and precedent trails
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to Dashboard
          </Link>
        </Button>
      </div>

      {/* Search Controls */}
      <div className="flex flex-wrap gap-3">
        <Input
          value={documentId}
          onChange={(e) => setDocumentId(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter Document ID to center graph"
          className="flex-1"
        />
        <Select
          value={String(depth)}
          onValueChange={(val) => setDepth(Number(val))}
        >
          <SelectTrigger className="w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Depth: 1</SelectItem>
            <SelectItem value="2">Depth: 2</SelectItem>
            <SelectItem value="3">Depth: 3</SelectItem>
          </SelectContent>
        </Select>
        <Button
          onClick={handleSearch}
          disabled={!documentId.trim()}
          size="sm"
        >
          <Search className="mr-1.5 h-3.5 w-3.5" />
          Visualize
        </Button>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="graph">
        <TabsList>
          <TabsTrigger value="graph">Network Graph</TabsTrigger>
          <TabsTrigger value="trail">Precedent Trail</TabsTrigger>
          <TabsTrigger value="unresolved">Unresolved Citations</TabsTrigger>
          <TabsTrigger value="case-codal">Case-Codal Links</TabsTrigger>
        </TabsList>

        <TabsContent value="graph">
          <GraphTab
            nodes={graphNodes}
            edges={graphEdges}
            centerNodeId={activeDocId}
            onNodeClick={handleNodeClick}
            isLoading={networkLoading}
            error={networkError}
          />
        </TabsContent>

        <TabsContent value="trail">
          <TrailTab
            nodes={trailNodes}
            edges={trailEdges}
            centerDocumentId={activeDocId}
            isLoading={networkLoading}
            error={networkError}
          />
        </TabsContent>

        <TabsContent value="unresolved">
          <UnresolvedTab />
        </TabsContent>

        <TabsContent value="case-codal">
          <CaseCodalTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---- Graph Tab ----

function GraphTab({
  nodes,
  edges,
  centerNodeId,
  onNodeClick,
  isLoading,
  error,
}: {
  nodes: ForceGraphNode[];
  edges: ForceGraphEdge[];
  centerNodeId?: string;
  onNodeClick: (id: string) => void;
  isLoading: boolean;
  error: Error | null;
}) {
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {error.message || 'Failed to load graph data'}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      {nodes.length > 0 && (
        <div className="flex gap-4">
          <Card>
            <CardContent className="px-4 py-2">
              <span className="text-xs text-muted-foreground">Nodes</span>
              <p className="text-lg font-bold">{nodes.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="px-4 py-2">
              <span className="text-xs text-muted-foreground">Edges</span>
              <p className="text-lg font-bold">{edges.length}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {isLoading ? (
        <div className="flex h-[500px] items-center justify-center rounded-md border bg-muted">
          <div className="text-sm text-muted-foreground">Loading graph...</div>
        </div>
      ) : (
        <ForceGraph
          nodes={nodes}
          edges={edges}
          centerNodeId={centerNodeId}
          onNodeClick={onNodeClick}
          width={900}
          height={550}
        />
      )}

      {/* Legend */}
      {nodes.length > 0 && (
        <Card>
          <CardContent className="flex flex-wrap gap-3 p-3">
            <span className="text-xs font-medium text-muted-foreground">Node Types:</span>
            {[
              { type: 'supreme_court_decision', color: '#3b82f6', label: 'SC Decision' },
              { type: 'court_of_appeals_decision', color: '#8b5cf6', label: 'CA Decision' },
              { type: 'statute', color: '#10b981', label: 'Statute' },
              { type: 'republic_act', color: '#06b6d4', label: 'Republic Act' },
              { type: 'executive_order', color: '#f59e0b', label: 'Exec. Order' },
            ].map((item) => (
              <span key={item.type} className="flex items-center gap-1 text-xs text-muted-foreground">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
                {item.label}
              </span>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---- Trail Tab ----

function TrailTab({
  nodes,
  edges,
  centerDocumentId,
  isLoading,
  error,
}: {
  nodes: TrailNode[];
  edges: TrailEdge[];
  centerDocumentId?: string;
  isLoading: boolean;
  error: Error | null;
}) {
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {error.message || 'Failed to load trail data'}
        </AlertDescription>
      </Alert>
    );
  }

  if (isLoading) {
    return <AdminListSkeleton count={4} />;
  }

  return (
    <PrecedentTrail
      nodes={nodes}
      edges={edges}
      centerDocumentId={centerDocumentId}
    />
  );
}

// ---- Unresolved Citations Tab ----

function UnresolvedTab() {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const { data, isLoading, error } = useUnresolvedCitations({ cursor });
  const triggerResolution = useTriggerCitationResolution();

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {error instanceof Error ? error.message : 'Failed to load unresolved citations'}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {triggerResolution.isSuccess && (
        <Alert>
          <AlertDescription className="text-green-700">
            Resolution triggered for &ldquo;{triggerResolution.data.documentTitle}&rdquo;
            — {triggerResolution.data.unresolvedCitationCount} unresolved citations
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <AdminListSkeleton count={5} />
      ) : data && data.items.length > 0 ? (
        <>
          {data.items.map((citation) => (
            <UnresolvedCitationCard
              key={citation.id}
              citation={citation}
              onTriggerResolution={(docId) => triggerResolution.mutate(docId)}
              isTriggering={triggerResolution.isPending}
            />
          ))}

          {data.meta.hasNext && data.meta.nextCursor && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={() => setCursor(data.meta.nextCursor)}>
                Load More
              </Button>
            </div>
          )}
        </>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">No unresolved citations found.</p>
      )}
    </div>
  );
}

// ---- Unresolved Citation Card ----

// ---- Case-Codal Links Tab ----

const LINK_TYPES = ['interprets', 'applies', 'invalidates', 'modifies', 'upholds', 'cites'] as const;

function CaseCodalTab() {
  const [caseDocFilter, setCaseDocFilter] = useState('');
  const [codalDocFilter, setCodalDocFilter] = useState('');
  const [linkTypeFilter, setLinkTypeFilter] = useState('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [createOpen, setCreateOpen] = useState(false);
  const [suggestDocId, setSuggestDocId] = useState('');

  const { data, isLoading, error } = useListCaseCodalLinks({
    caseDocumentId: caseDocFilter || undefined,
    codalDocumentId: codalDocFilter || undefined,
    linkType: linkTypeFilter || undefined,
    cursor,
  });

  const suggestLinks = useSuggestCaseCodalLinks();

  const handleSuggest = () => {
    if (suggestDocId.trim()) {
      suggestLinks.mutate(suggestDocId.trim());
    }
  };

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {error instanceof Error ? error.message : 'Failed to load case-codal links'}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <div className="flex flex-wrap gap-3">
        <Input
          value={caseDocFilter}
          onChange={(e) => { setCaseDocFilter(e.target.value); setCursor(undefined); }}
          placeholder="Case Document ID"
          className="w-[220px]"
        />
        <Input
          value={codalDocFilter}
          onChange={(e) => { setCodalDocFilter(e.target.value); setCursor(undefined); }}
          placeholder="Codal Document ID"
          className="w-[220px]"
        />
        <Select
          value={linkTypeFilter || '__all__'}
          onValueChange={(val) => { setLinkTypeFilter(val === '__all__' ? '' : val); setCursor(undefined); }}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All Link Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Link Types</SelectItem>
            {LINK_TYPES.map((lt) => (
              <SelectItem key={lt} value={lt}>
                {lt.charAt(0).toUpperCase() + lt.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <CreateCaseCodalDialog open={createOpen} onOpenChange={setCreateOpen} />

        <div className="flex items-center gap-2">
          <Input
            value={suggestDocId}
            onChange={(e) => setSuggestDocId(e.target.value)}
            placeholder="Document ID for AI suggestions"
            className="w-[240px]"
          />
          <Button
            size="sm"
            onClick={handleSuggest}
            disabled={!suggestDocId.trim() || suggestLinks.isPending}
          >
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            {suggestLinks.isPending ? 'Suggesting...' : 'AI Suggest'}
          </Button>
        </div>
      </div>

      {/* AI Suggestions */}
      {suggestLinks.isSuccess && suggestLinks.data.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">AI Suggestions</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {suggestLinks.data.map((suggestion, idx) => (
              <SuggestionCard key={idx} suggestion={suggestion} />
            ))}
          </div>
        </div>
      )}
      {suggestLinks.isSuccess && suggestLinks.data.length === 0 && (
        <Alert>
          <AlertDescription>No suggestions found for this document.</AlertDescription>
        </Alert>
      )}
      {suggestLinks.isError && (
        <Alert variant="destructive">
          <AlertDescription>Failed to get suggestions.</AlertDescription>
        </Alert>
      )}

      {/* Links Table */}
      {isLoading ? (
        <AdminListSkeleton count={5} />
      ) : data && data.items.length > 0 ? (
        <>
          <div className="space-y-2">
            {data.items.map((link) => (
              <CaseCodalLinkCard key={link.id} link={link} />
            ))}
          </div>

          {data.meta.hasNext && data.meta.nextCursor && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={() => setCursor(data.meta.nextCursor)}>
                Load More
              </Button>
            </div>
          )}
        </>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No case-codal links found. Use the filter bar to search or create new links.
        </p>
      )}
    </div>
  );
}

// ---- Create Case-Codal Link Dialog ----

function CreateCaseCodalDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [caseDocId, setCaseDocId] = useState('');
  const [codalDocId, setCodalDocId] = useState('');
  const [codalSectionId, setCodalSectionId] = useState('');
  const [linkType, setLinkType] = useState('cites');
  const [notes, setNotes] = useState('');
  const [confidence, setConfidence] = useState(80);

  const createLink = useCreateCaseCodalLink();

  const handleCreate = async () => {
    if (!caseDocId.trim() || !codalDocId.trim()) return;
    try {
      await createLink.mutateAsync({
        caseDocumentId: caseDocId.trim(),
        codalDocumentId: codalDocId.trim(),
        codalSectionId: codalSectionId.trim() || undefined,
        linkType,
        notes: notes.trim() || undefined,
      });
      setCaseDocId('');
      setCodalDocId('');
      setCodalSectionId('');
      setLinkType('cites');
      setNotes('');
      setConfidence(80);
      onOpenChange(false);
    } catch {
      // error shown via mutation state
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Create Link
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Case-Codal Link</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="create-case-doc">Case Document ID</Label>
            <Input id="create-case-doc" value={caseDocId} onChange={(e) => setCaseDocId(e.target.value)} placeholder="Enter case document ID" className="mt-1" />
          </div>
          <div>
            <Label htmlFor="create-codal-doc">Codal Document ID</Label>
            <Input id="create-codal-doc" value={codalDocId} onChange={(e) => setCodalDocId(e.target.value)} placeholder="Enter codal document ID" className="mt-1" />
          </div>
          <div>
            <Label htmlFor="create-codal-section">Codal Section ID (optional)</Label>
            <Input id="create-codal-section" value={codalSectionId} onChange={(e) => setCodalSectionId(e.target.value)} placeholder="Enter codal section ID" className="mt-1" />
          </div>
          <div>
            <Label htmlFor="create-link-type">Link Type</Label>
            <Select value={linkType} onValueChange={setLinkType}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LINK_TYPES.map((lt) => (
                  <SelectItem key={lt} value={lt}>
                    {lt.charAt(0).toUpperCase() + lt.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="create-notes">Notes (optional)</Label>
            <Textarea id="create-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-1" placeholder="Add notes about this link..." />
          </div>
          <div>
            <Label>Confidence: {confidence}%</Label>
            <input
              type="range"
              min={0}
              max={100}
              value={confidence}
              onChange={(e) => setConfidence(Number(e.target.value))}
              className="mt-1 w-full"
            />
          </div>
          {createLink.isError && (
            <p className="text-xs text-destructive">Failed to create link.</p>
          )}
          <Button
            onClick={handleCreate}
            disabled={createLink.isPending || !caseDocId.trim() || !codalDocId.trim()}
            className="w-full"
          >
            {createLink.isPending ? 'Creating...' : 'Create Link'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---- Case-Codal Link Card ----

function CaseCodalLinkCard({ link }: { link: CaseCodalLinkItem }) {
  const [editing, setEditing] = useState(false);
  const [editLinkType, setEditLinkType] = useState(link.linkType);
  const [editNotes, setEditNotes] = useState(link.notes ?? '');
  const [editConfidence, setEditConfidence] = useState(
    link.confidence !== null ? Math.round(link.confidence * 100) : 80,
  );

  const updateLink = useUpdateCaseCodalLink();
  const deleteLink = useDeleteCaseCodalLink();

  const handleUpdate = async () => {
    try {
      await updateLink.mutateAsync({
        id: link.id,
        data: {
          linkType: editLinkType,
          notes: editNotes.trim() || undefined,
          confidence: editConfidence / 100,
        },
      });
      setEditing(false);
    } catch {
      // error shown inline
    }
  };

  const handleDelete = async () => {
    try {
      await deleteLink.mutateAsync(link.id);
    } catch {
      // error shown inline
    }
  };

  const linkTypeColor: Record<string, string> = {
    interprets: 'bg-blue-100 text-blue-700',
    applies: 'bg-green-100 text-green-700',
    invalidates: 'bg-red-100 text-red-700',
    modifies: 'bg-yellow-100 text-yellow-700',
    upholds: 'bg-emerald-100 text-emerald-700',
    cites: 'bg-muted text-muted-foreground',
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">
                {link.caseDocument?.title ?? link.caseDocumentId}
              </span>
              {link.caseDocument?.grNo && (
                <span className="text-xs text-muted-foreground">({link.caseDocument.grNo})</span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>&rarr;</span>
              <span>{link.codalDocument?.title ?? link.codalDocumentId}</span>
              {link.codalSectionId && <span className="text-muted-foreground">(Section: {link.codalSectionId})</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Badge className={linkTypeColor[link.linkType] ?? 'bg-muted text-muted-foreground'}>
                {link.linkType}
              </Badge>
              {link.confidence !== null && (
                <span className="text-xs text-muted-foreground">
                  {(link.confidence * 100).toFixed(0)}% confidence
                </span>
              )}
              {link.notes && (
                <span className="text-xs text-muted-foreground italic">{link.notes}</span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" size="sm" onClick={() => setEditing(!editing)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              disabled={deleteLink.isPending}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {editing && (
          <>
            <Separator className="my-3" />
            <div className="space-y-2">
              <div>
                <Label className="text-xs">Link Type</Label>
                <Select value={editLinkType} onValueChange={setEditLinkType}>
                  <SelectTrigger className="mt-1 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LINK_TYPES.map((lt) => (
                      <SelectItem key={lt} value={lt}>
                        {lt.charAt(0).toUpperCase() + lt.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Notes</Label>
                <Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={2} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Confidence: {editConfidence}%</Label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={editConfidence}
                  onChange={(e) => setEditConfidence(Number(e.target.value))}
                  className="mt-1 w-full"
                />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleUpdate} disabled={updateLink.isPending}>
                  {updateLink.isPending ? 'Saving...' : 'Save'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---- AI Suggestion Card ----

function SuggestionCard({ suggestion }: { suggestion: CaseCodalSuggestion }) {
  const createLink = useCreateCaseCodalLink();
  const [accepted, setAccepted] = useState(false);

  const handleAccept = async () => {
    try {
      await createLink.mutateAsync({
        caseDocumentId: suggestion.caseDocumentId,
        codalDocumentId: suggestion.codalDocumentId,
        codalSectionId: suggestion.codalSectionId ?? undefined,
        linkType: suggestion.suggestedLinkType,
        notes: suggestion.reasoning,
      });
      setAccepted(true);
    } catch {
      // error via mutation state
    }
  };

  if (accepted) {
    return (
      <Card className="bg-green-50 p-3">
        <p className="text-xs text-green-700">Link created successfully.</p>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-3 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">
            {suggestion.caseDocument?.title ?? suggestion.caseDocumentId}
          </p>
          <Badge className="bg-blue-100 text-blue-700">
            {suggestion.suggestedLinkType}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          &rarr; {suggestion.codalDocument?.title ?? suggestion.codalDocumentId}
        </p>
        <p className="text-xs text-muted-foreground italic">{suggestion.reasoning}</p>
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-muted-foreground">
            {(suggestion.confidence * 100).toFixed(0)}% confidence
          </span>
          <div className="flex gap-1">
            <Button
              size="sm"
              className="h-6 px-2 text-xs bg-green-600 hover:bg-green-700"
              onClick={handleAccept}
              disabled={createLink.isPending}
            >
              {createLink.isPending ? 'Accepting...' : 'Accept'}
            </Button>
          </div>
        </div>
        {createLink.isError && (
          <p className="text-xs text-destructive">Failed to create link.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Unresolved Citation Card ----

function UnresolvedCitationCard({
  citation,
  onTriggerResolution,
  isTriggering,
}: {
  citation: UnresolvedCitationItem;
  onTriggerResolution: (documentId: string) => void;
  isTriggering: boolean;
}) {
  const resolve = useResolveCitation();
  const [targetDocId, setTargetDocId] = useState('');
  const [showResolve, setShowResolve] = useState(false);

  const handleResolve = async () => {
    if (!targetDocId.trim()) return;
    try {
      await resolve.mutateAsync({
        citationId: citation.id,
        targetDocumentId: targetDocId.trim(),
      });
      setShowResolve(false);
      setTargetDocId('');
    } catch {
      // error shown inline
    }
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <p className="text-sm font-medium">{citation.citationText}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge className="bg-muted text-muted-foreground">
                {citation.citationType}
              </Badge>
              {citation.normalizedCitation && (
                <span className="text-xs text-muted-foreground">
                  Normalized: {citation.normalizedCitation}
                </span>
              )}
              {citation.confidence !== null && (
                <span className="text-xs text-muted-foreground">
                  {(citation.confidence * 100).toFixed(0)}% confidence
                </span>
              )}
            </div>
            {citation.fromDocument && (
              <p className="mt-1 text-xs text-muted-foreground">
                From:{' '}
                <Link
                  href={`/reader/${citation.fromDocument.id}`}
                  className="text-blue-600 hover:underline"
                >
                  {citation.fromDocument.title}
                </Link>
                {citation.fromDocument.grNo && ` (${citation.fromDocument.grNo})`}
              </p>
            )}
          </div>

          <div className="flex shrink-0 gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowResolve(!showResolve)}
            >
              Resolve
            </Button>
            <Button
              size="sm"
              onClick={() => onTriggerResolution(citation.fromDocumentId)}
              disabled={isTriggering}
            >
              <Wand2 className="mr-1 h-3 w-3" />
              Auto-resolve
            </Button>
          </div>
        </div>

        {showResolve && (
          <>
            <Separator className="my-3" />
            <div className="flex gap-2">
              <Input
                value={targetDocId}
                onChange={(e) => setTargetDocId(e.target.value)}
                placeholder="Target Document ID"
                className="flex-1"
              />
              <Button
                size="sm"
                onClick={handleResolve}
                disabled={resolve.isPending || !targetDocId.trim()}
                className="bg-green-600 hover:bg-green-700"
              >
                {resolve.isPending ? 'Resolving...' : 'Confirm'}
              </Button>
              {resolve.isError && (
                <span className="self-center text-xs text-destructive">Failed</span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

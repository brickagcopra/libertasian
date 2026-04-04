// =====================================================================
// Knowledge Graph Types — Phase 5 Batch 2
// =====================================================================

/** Node in citation graph (lightweight document representation). */
export interface GraphNode {
  id: string;
  title: string;
  shortTitle: string | null;
  citationText: string | null;
  grNo: string | null;
  documentType: string;
  court: string | null;
  decisionDate: string | null;
}

/** Edge in citation graph (document-to-document citation). */
export interface GraphEdge {
  id: string;
  fromDocumentId: string;
  toDocumentId: string;
  citationText: string;
  citationType: string;
  confidence: number | null;
}

/** Result of a graph query (nodes + edges). */
export interface GraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Case-codal link types. */
export enum CaseCodalLinkType {
  INTERPRETS = 'interprets',
  APPLIES = 'applies',
  INVALIDATES = 'invalidates',
  MODIFIES = 'modifies',
  UPHOLDS = 'upholds',
  CITES = 'cites',
}

/** Case-codal link item returned by API. */
export interface CaseCodalLinkItem {
  id: string;
  caseDocumentId: string;
  codalDocumentId: string;
  codalSectionId: string | null;
  linkType: string;
  notes: string | null;
  confidence: number | null;
  createdByUserId: string;
  createdAt: string;
  caseDocument?: {
    id: string;
    title: string;
    citationText: string | null;
    grNo: string | null;
    court?: string | null;
    decisionDate?: string | null;
  };
  codalDocument?: {
    id: string;
    title: string;
    citationText: string | null;
    documentType?: string;
  };
  codalSection?: {
    id: string;
    sectionType: string;
    sectionLabel: string | null;
  } | null;
  createdBy?: {
    id: string;
    fullName: string;
  };
}

/** Unresolved citation item returned by API. */
export interface UnresolvedCitationItem {
  id: string;
  fromDocumentId: string;
  citationText: string;
  citationType: string;
  normalizedCitation: string | null;
  confidence: number | null;
  createdAt: string;
  fromDocument?: {
    id: string;
    title: string;
    citationText: string | null;
    grNo: string | null;
    documentType: string;
  };
  fromSection?: {
    id: string;
    sectionType: string;
    sectionLabel: string | null;
  } | null;
}

/** Citation resolution trigger response. */
export interface CitationResolutionResult {
  documentId: string;
  documentTitle: string;
  unresolvedCitationCount: number;
  status: 'queued' | 'processing' | 'completed';
}

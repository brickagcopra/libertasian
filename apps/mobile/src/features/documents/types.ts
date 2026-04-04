export interface LegalDocument {
  id: string;
  title: string;
  shortTitle: string | null;
  citationText: string | null;
  grNo: string | null;
  docketNo: string | null;
  documentType: string;
  court: string | null;
  ponente: string | null;
  agency: string | null;
  jurisdiction: string;
  language: string;
  decisionDate: string | null;
  promulgationDate: string | null;
  publicationDate: string | null;
  status: string;
  isOfficial: boolean;
  isPublished: boolean;
  truthfulnessStatus: string;
  versionNo: number;
  createdAt: string;
  source?: {
    id: string;
    name: string;
    type: string;
    trustLevel: string;
  } | null;
  _count?: {
    sections: number;
    citations: number;
    bookmarks: number;
    digests: number;
  };
}

export interface DocumentSection {
  id: string;
  legalDocumentId: string;
  parentSectionId: string | null;
  sectionType: string;
  sectionLabel: string | null;
  ordering: number;
  plainText: string | null;
  htmlText: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  tokenCount: number | null;
  createdAt: string;
}

// =====================================================================
// Doctrine Types — Phase 5 Batch 6
// =====================================================================

/** Type of legal doctrine extracted from a case or codal provision. */
export enum DoctrineType {
  RATIO_DECIDENDI = 'ratio_decidendi',
  OBITER_DICTUM = 'obiter_dictum',
  STARE_DECISIS = 'stare_decisis',
  STATUTORY_CONSTRUCTION = 'statutory_construction',
  CONSTITUTIONAL_INTERPRETATION = 'constitutional_interpretation',
  PROCEDURAL_RULE = 'procedural_rule',
  EVIDENTIARY_RULE = 'evidentiary_rule',
  OTHER = 'other',
}

/** Type of link between two doctrines. */
export enum DoctrineLinkType {
  EXTENDS = 'extends',
  OVERRULES = 'overrules',
  DISTINGUISHES = 'distinguishes',
  APPLIES = 'applies',
  CLARIFIES = 'clarifies',
}

/** Doctrine item returned by API. */
export interface DoctrineItem {
  id: string;
  text: string;
  normalizedText: string | null;
  doctrineType: string;
  confidence: number | null;
  reviewStatus: string;
  createdAt: string;
  updatedAt: string;
  legalDocumentId: string | null;
  digestId: string | null;
  sourceSectionId: string | null;
  legalDocument?: {
    id: string;
    title: string;
    citationText: string | null;
    grNo: string | null;
    court: string | null;
    decisionDate: string | null;
  } | null;
  digest?: {
    id: string;
    title: string;
  } | null;
  sourceSection?: {
    id: string;
    sectionType: string;
    sectionLabel: string | null;
  } | null;
  linksFrom?: DoctrineLinkItem[];
  linksTo?: DoctrineLinkItem[];
}

/** Link between two doctrines. */
export interface DoctrineLinkItem {
  id: string;
  fromDoctrineId: string;
  toDoctrineId: string;
  linkType: string;
  confidence: number | null;
  createdAt: string;
  fromDoctrine?: {
    id: string;
    text: string;
    doctrineType: string;
  };
  toDoctrine?: {
    id: string;
    text: string;
    doctrineType: string;
  };
}

/** Result of doctrine extraction from a document. */
export interface DoctrineExtractionResult {
  documentId: string;
  documentTitle: string;
  doctrinesExtracted: number;
  status: 'queued' | 'processing' | 'completed';
}

export type AnnotationColor = 'yellow' | 'green' | 'blue' | 'red' | 'purple';

/**
 * Offset-based anchor into a section's `plainText`. Mobile anchors whole
 * paragraphs (RN has no selection-range API), which stays fully compatible
 * with web's offset-based highlight renderer.
 */
export interface TextAnchor {
  startOffset: number;
  endOffset: number;
  anchorText: string;
}

export interface Annotation {
  id: string;
  userId: string;
  legalDocumentId: string;
  sectionId: string | null;
  textAnchor: TextAnchor;
  annotationText: string | null;
  color: string;
  createdAt: string;
  legalDocument?: {
    id: string;
    title: string;
    shortTitle: string | null;
    citationText: string | null;
  };
  section?: {
    id: string;
    sectionType: string;
    sectionLabel: string | null;
  } | null;
}

export interface CreateAnnotationRequest {
  legalDocumentId: string;
  sectionId?: string;
  textAnchor: TextAnchor;
  annotationText?: string;
  color?: AnnotationColor;
}

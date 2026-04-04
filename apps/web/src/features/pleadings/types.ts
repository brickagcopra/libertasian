// ─── Pleading Types ────────────────────────────────────────

export type PleadingCategory =
  | 'motion'
  | 'complaint'
  | 'petition'
  | 'answer'
  | 'memorandum'
  | 'appeal'
  | 'other';

export type PleadingStatus = 'pending' | 'generating' | 'completed' | 'failed';

// ─── Citation Ref ──────────────────────────────────────────

export interface CitationRef {
  sourceId: string;
  sectionId?: string | null;
  text: string;
}

// ─── Template Structures ───────────────────────────────────

export interface PleadingTemplateSection {
  key: string;
  label: string;
  description: string;
  required: boolean;
  inputType: 'text' | 'textarea' | 'select' | 'date' | 'party_list';
  options?: string[];
}

export interface PleadingTemplateJson {
  sections: PleadingTemplateSection[];
  outputFormat: string;
}

export interface PleadingTemplateListItem {
  id: string;
  name: string;
  slug: string;
  category: string;
  court: string | null;
  description: string | null;
  isActive: boolean;
}

export interface PleadingTemplateDetail extends PleadingTemplateListItem {
  templateJson: PleadingTemplateJson;
}

// ─── Generated Output ──────────────────────────────────────

export interface PleadingSectionOutput {
  key: string;
  heading: string;
  content: string;
  citations: CitationRef[];
}

export interface PleadingGeneratedOutput {
  title: string;
  sections: PleadingSectionOutput[];
}

// ─── List / Detail ─────────────────────────────────────────

export interface PleadingListItem {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  matterId: string | null;
  matter?: { id: string; title: string } | null;
  template: { id: string; name: string; category: string };
}

export interface PleadingDetail extends PleadingListItem {
  inputData: Record<string, unknown>;
  generatedOutput: PleadingGeneratedOutput | null;
  citationsJson: CitationRef[];
  modelRunId: string | null;
  userId: string;
  organizationId: string;
}

// ─── API Responses ─────────────────────────────────────────

export interface PaginationMeta {
  hasNext: boolean;
  nextCursor?: string;
  limit: number;
}

export interface PleadingListResponse {
  success: boolean;
  data: PleadingListItem[];
  meta: PaginationMeta;
}

export interface PleadingDetailResponse {
  success: boolean;
  data: PleadingDetail;
}

export interface PleadingTemplateListResponse {
  success: boolean;
  data: PleadingTemplateListItem[];
}

export interface PleadingTemplateDetailResponse {
  success: boolean;
  data: PleadingTemplateDetail;
}

// ─── Input Types ───────────────────────────────────────────

export interface GeneratePleadingInput {
  templateId: string;
  inputData: Record<string, unknown>;
  contextQuery?: string;
  matterId?: string;
}

// ─── Filter Types ──────────────────────────────────────────

export interface PleadingFilters {
  status?: string;
  templateId?: string;
  category?: string;
  matterId?: string;
  cursor?: string;
  limit?: number;
}

// ─── Display Helpers ───────────────────────────────────────

export const PLEADING_CATEGORY_LABELS: Record<string, string> = {
  motion: 'Motion',
  complaint: 'Complaint',
  petition: 'Petition',
  answer: 'Answer',
  memorandum: 'Memorandum',
  appeal: 'Appeal',
  other: 'Other',
};

export const PLEADING_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  generating: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

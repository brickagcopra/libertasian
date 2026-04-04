// ─── Hearing Prep Types ──────────────────────────────────

export type HearingPrepStatus = 'pending' | 'generating' | 'completed' | 'failed';

export type ArgumentStrength = 'strong' | 'moderate' | 'weak';

// ─── Result Structures ─────────────────────────────────────

export interface HearingPrepCase {
  documentId: string;
  title: string;
  citationText: string | null;
  relevance: string;
  keyHoldings: string[];
}

export interface HearingPrepProvision {
  documentId: string;
  sectionId: string | null;
  title: string;
  sectionLabel: string | null;
  text: string;
  relevance: string;
}

export interface HearingPrepArgument {
  position: string;
  supportingCases: string[];
  supportingProvisions: string[];
  strength: ArgumentStrength;
}

export interface HearingPrepPackResult {
  cases: HearingPrepCase[];
  provisions: HearingPrepProvision[];
  arguments: HearingPrepArgument[];
  counterArguments: HearingPrepArgument[];
  suggestedQuestions: string[];
}

// ─── List / Detail ─────────────────────────────────────────

export interface HearingPrepListItem {
  id: string;
  topic: string;
  issue: string | null;
  status: string;
  createdAt: string;
  matterId: string | null;
  matter?: { id: string; title: string } | null;
}

export interface HearingPrepDetail extends HearingPrepListItem {
  documentIds: string[];
  inputContext: Record<string, unknown> | null;
  packJson: HearingPrepPackResult | null;
  modelRunId: string | null;
  userId: string;
  organizationId: string;
  updatedAt: string;
}

// ─── API Responses ─────────────────────────────────────────

export interface PaginationMeta {
  hasNext: boolean;
  nextCursor?: string;
  limit: number;
}

export interface HearingPrepListResponse {
  success: boolean;
  data: HearingPrepListItem[];
  meta: PaginationMeta;
}

export interface HearingPrepDetailResponse {
  success: boolean;
  data: HearingPrepDetail;
}

// ─── Input Types ───────────────────────────────────────────

export interface GenerateHearingPrepInput {
  topic: string;
  issue?: string;
  documentIds?: string[];
  inputContext?: Record<string, unknown>;
  matterId?: string;
}

// ─── Filter Types ──────────────────────────────────────────

export interface HearingPrepFilters {
  status?: string;
  matterId?: string;
  cursor?: string;
  limit?: number;
}

// ─── Display Helpers ───────────────────────────────────────

export const HEARING_PREP_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  generating: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

export const HEARING_PREP_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  generating: 'Generating...',
  completed: 'Completed',
  failed: 'Failed',
};

export const ARGUMENT_STRENGTH_COLORS: Record<string, string> = {
  strong: 'bg-green-100 text-green-700',
  moderate: 'bg-yellow-100 text-yellow-700',
  weak: 'bg-red-100 text-red-700',
};

export const ARGUMENT_STRENGTH_LABELS: Record<string, string> = {
  strong: 'Strong',
  moderate: 'Moderate',
  weak: 'Weak',
};

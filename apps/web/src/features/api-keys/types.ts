// ─── API Key Types ──────────────────────────────────────────

export type ApiKeyPermission =
  | 'search'
  | 'documents:read'
  | 'digests:read'
  | 'memos:generate'
  | 'memos:read'
  | 'comparisons:generate'
  | 'comparisons:read';

// ─── List / Detail ──────────────────────────────────────────

export interface ApiKeyListItem {
  id: string;
  name: string;
  keyPrefix: string;
  permissions: string[];
  rateLimitPerMinute: number;
  isActive: boolean;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface ApiKeyDetail extends ApiKeyListItem {
  updatedAt: string;
  userId: string;
  organizationId: string;
}

// ─── API Responses ──────────────────────────────────────────

export interface ApiKeyListResponse {
  success: boolean;
  data: ApiKeyListItem[];
  cursor: string | null;
  hasNext: boolean;
}

export interface ApiKeyDetailResponse {
  success: boolean;
  data: ApiKeyDetail;
}

export interface ApiKeyCreateResponse {
  success: boolean;
  data: {
    id: string;
    name: string;
    keyPrefix: string;
    key: string; // Raw key — shown only once
  };
}

// ─── Input Types ────────────────────────────────────────────

export interface CreateApiKeyInput {
  name: string;
  permissions: string[];
  rateLimitPerMinute?: number;
  expiresAt?: string;
}

export interface UpdateApiKeyInput {
  name?: string;
  permissions?: string[];
  rateLimitPerMinute?: number;
  isActive?: boolean;
  expiresAt?: string | null;
}

// ─── Filter Types ───────────────────────────────────────────

export interface ApiKeyFilters {
  cursor?: string;
  limit?: number;
}

// ─── Display Helpers ────────────────────────────────────────

export const ALL_PERMISSIONS: { value: ApiKeyPermission; label: string }[] = [
  { value: 'search', label: 'Search' },
  { value: 'documents:read', label: 'Read Documents' },
  { value: 'digests:read', label: 'Read Digests' },
  { value: 'memos:generate', label: 'Generate Memos' },
  { value: 'memos:read', label: 'Read Memos' },
  { value: 'comparisons:generate', label: 'Generate Comparisons' },
  { value: 'comparisons:read', label: 'Read Comparisons' },
];

export const PERMISSION_LABELS: Record<string, string> = {
  search: 'Search',
  'documents:read': 'Read Documents',
  'digests:read': 'Read Digests',
  'memos:generate': 'Generate Memos',
  'memos:read': 'Read Memos',
  'comparisons:generate': 'Generate Comparisons',
  'comparisons:read': 'Read Comparisons',
};

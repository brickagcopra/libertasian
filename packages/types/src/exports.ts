// ==========================================================================
// Document Export Types
// ==========================================================================

import type { ExportFormat } from './study';

export type ExportContentType = 'digest' | 'memo' | 'note';

export type ExportStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface ExportJobListItem {
  id: string;
  contentType: ExportContentType;
  contentId: string;
  format: ExportFormat;
  status: ExportStatus;
  filename: string | null;
  fileSizeBytes: number | null;
  failureReason: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface ExportJobDetail extends ExportJobListItem {
  organizationId: string;
  userId: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export interface CreateExportRequest {
  contentType: ExportContentType;
  contentId: string;
  format: ExportFormat;
}

export interface CreateExportResponse {
  success: true;
  data: ExportJobDetail;
}

export interface ListExportsResponse {
  success: true;
  data: ExportJobListItem[];
  nextCursor: string | null;
}

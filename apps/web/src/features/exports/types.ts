// ==========================================================================
// Document Export — Web Frontend Types
// ==========================================================================

export type ExportContentType = 'digest' | 'memo' | 'note';
export type ExportFormat = 'pdf' | 'docx';
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

export const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = {
  pdf: 'PDF',
  docx: 'Word (DOCX)',
};

export const EXPORT_STATUS_LABELS: Record<ExportStatus, string> = {
  pending: 'Pending',
  processing: 'Processing',
  completed: 'Ready',
  failed: 'Failed',
};

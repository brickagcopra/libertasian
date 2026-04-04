export type ExportFormat = 'pdf' | 'docx';

export type ExportContentType = 'digest' | 'memo' | 'note';

export type ExportStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface ExportJobDetail {
  id: string;
  contentType: ExportContentType;
  contentId: string;
  format: ExportFormat;
  status: ExportStatus;
  filename: string | null;
  fileSizeBytes: number | null;
  failureReason: string | null;
  expiresAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateExportRequest {
  contentType: ExportContentType;
  contentId: string;
  format: ExportFormat;
}

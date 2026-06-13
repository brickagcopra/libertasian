'use client';

import { useCallback, useState } from 'react';
import {
  Loader2Icon,
  CheckCircle2Icon,
  AlertCircleIcon,
  DownloadIcon,
  FileTextIcon,
  FileIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  useCreateExport,
  useExport,
  useDownloadExport,
} from '../hooks/use-exports';
import type { ExportContentType, ExportFormat } from '../types';
import { EXPORT_FORMAT_LABELS } from '../types';

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  contentType: ExportContentType;
  contentId: string;
  title?: string;
}

export function ExportDialog({
  open,
  onClose,
  contentType,
  contentId,
  title,
}: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('pdf');
  const [exportJobId, setExportJobId] = useState<string | null>(null);

  const createExport = useCreateExport();
  const downloadExport = useDownloadExport();
  const { data: exportJob } = useExport(exportJobId);

  const isCreating = createExport.isPending;
  const isProcessing =
    exportJob?.status === 'pending' || exportJob?.status === 'processing';
  const isCompleted = exportJob?.status === 'completed';
  const isFailed = exportJob?.status === 'failed';
  const isDownloading = downloadExport.isPending;

  const busy = isCreating || isProcessing;

  const handleExport = useCallback(async () => {
    try {
      const job = await createExport.mutateAsync({
        contentType,
        contentId,
        format,
      });
      setExportJobId(job.id);
    } catch {
      // Error available via createExport.error
    }
  }, [createExport, contentType, contentId, format]);

  const handleDownload = useCallback(async () => {
    if (!exportJobId) return;
    try {
      await downloadExport.mutateAsync(exportJobId);
      setExportJobId(null);
      onClose();
    } catch {
      // Error available via downloadExport.error
    }
  }, [exportJobId, downloadExport, onClose]);

  const handleClose = useCallback(() => {
    if (busy || isDownloading) return;
    setExportJobId(null);
    createExport.reset();
    onClose();
  }, [busy, isDownloading, onClose, createExport]);

  if (!open) return null;

  const contentLabel =
    contentType === 'digest'
      ? 'Digest'
      : contentType === 'memo'
        ? 'Memo'
        : 'Note';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50"
        onClick={handleClose}
        aria-hidden
      />
      <div className="relative z-10 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        {/* Header */}
        <h2 className="text-lg font-semibold">
          Export {contentLabel}
        </h2>
        {title && (
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {title}
          </p>
        )}

        {/* Format Selection */}
        {!exportJobId && (
          <div className="mt-4 space-y-2">
            <p className="text-sm font-medium">Choose format:</p>
            <div className="flex gap-3">
              <FormatOption
                format="pdf"
                selected={format === 'pdf'}
                onSelect={setFormat}
                icon={<FileTextIcon className="size-5" />}
              />
              <FormatOption
                format="docx"
                selected={format === 'docx'}
                onSelect={setFormat}
                icon={<FileIcon className="size-5" />}
              />
            </div>
          </div>
        )}

        {/* Processing State */}
        {(isCreating || isProcessing) && (
          <div className="mt-4 flex items-center gap-3 rounded-md border border-blue-200 bg-blue-50 p-3">
            <Loader2Icon className="size-5 shrink-0 animate-spin text-blue-600" />
            <div>
              <p className="text-sm font-medium text-blue-800">
                {isCreating ? 'Creating export...' : 'Generating file...'}
              </p>
              <p className="text-xs text-blue-600">
                This usually takes a few seconds.
              </p>
            </div>
          </div>
        )}

        {/* Completed State */}
        {isCompleted && (
          <div className="mt-4 flex items-center gap-3 rounded-md border border-green-200 bg-green-50 p-3">
            <CheckCircle2Icon className="size-5 shrink-0 text-green-600" />
            <div>
              <p className="text-sm font-medium text-green-800">
                Export ready!
              </p>
              {exportJob?.filename && (
                <p className="text-xs text-green-600">
                  {exportJob.filename}
                  {exportJob.fileSizeBytes
                    ? ` (${formatBytes(exportJob.fileSizeBytes)})`
                    : ''}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Failed State */}
        {isFailed && (
          <div className="mt-4 flex items-center gap-3 rounded-md border border-red-200 bg-red-50 p-3">
            <AlertCircleIcon className="size-5 shrink-0 text-red-500" />
            <div>
              <p className="text-sm font-medium text-red-800">Export failed</p>
              <p className="text-xs text-red-600">
                {exportJob?.failureReason ?? 'An unexpected error occurred.'}
              </p>
            </div>
          </div>
        )}

        {/* Error from mutation */}
        {createExport.error && !exportJobId && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3">
            <p className="text-sm text-red-700">
              {createExport.error instanceof Error
                ? createExport.error.message
                : 'Failed to create export.'}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={handleClose} disabled={busy || isDownloading}>
            {isCompleted ? 'Close' : 'Cancel'}
          </Button>

          {!exportJobId && (
            <Button onClick={handleExport} disabled={busy}>
              {isCreating ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <DownloadIcon className="size-4" />
              )}
              {isCreating ? 'Creating...' : 'Export'}
            </Button>
          )}

          {isCompleted && (
            <Button onClick={handleDownload} disabled={isDownloading}>
              {isDownloading ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <DownloadIcon className="size-4" />
              )}
              {isDownloading ? 'Downloading...' : 'Download'}
            </Button>
          )}

          {isFailed && (
            <Button
              variant="outline"
              onClick={() => {
                setExportJobId(null);
                createExport.reset();
              }}
            >
              Try Again
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function FormatOption({
  format,
  selected,
  onSelect,
  icon,
}: {
  format: ExportFormat;
  selected: boolean;
  onSelect: (f: ExportFormat) => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(format)}
      className={`flex flex-1 items-center gap-2 rounded-md border-2 p-3 text-sm transition-colors ${
        selected
          ? 'border-blue-500 bg-blue-50 text-blue-700'
          : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      {icon}
      {EXPORT_FORMAT_LABELS[format]}
    </button>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

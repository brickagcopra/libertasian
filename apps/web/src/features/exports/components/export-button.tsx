'use client';

import { useCallback, useState } from 'react';
import {
  DownloadIcon,
  FileTextIcon,
  FileIcon,
  Loader2Icon,
  CheckCircle2Icon,
  AlertCircleIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCreateExport, useExport, useDownloadExport } from '../hooks/use-exports';
import type { ExportContentType, ExportFormat } from '../types';

interface ExportButtonProps {
  contentType: ExportContentType;
  contentId: string;
}

export function ExportButton({ contentType, contentId }: ExportButtonProps) {
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

  const busy = isCreating || isProcessing || isDownloading;

  const handleExport = useCallback(
    async (format: ExportFormat) => {
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
    },
    [createExport, contentType, contentId],
  );

  const handleDownload = useCallback(async () => {
    if (!exportJobId) return;
    try {
      await downloadExport.mutateAsync(exportJobId);
      setExportJobId(null);
    } catch {
      // Error available via downloadExport.error
    }
  }, [exportJobId, downloadExport]);

  // Show download button when export is ready
  if (isCompleted && exportJobId) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={handleDownload}
        disabled={isDownloading}
      >
        {isDownloading ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : (
          <CheckCircle2Icon className="size-4 text-green-600" />
        )}
        {isDownloading ? 'Downloading...' : 'Download'}
      </Button>
    );
  }

  // Show failed state with retry
  if (isFailed && exportJobId) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <AlertCircleIcon className="size-4 text-red-500" />
            Export failed — retry
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => {
              setExportJobId(null);
              handleExport('pdf');
            }}
          >
            <FileTextIcon className="size-4" />
            Retry as PDF
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setExportJobId(null);
              handleExport('docx');
            }}
          >
            <FileIcon className="size-4" />
            Retry as Word (DOCX)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // Default: show export dropdown or processing state
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy}>
          {busy ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <DownloadIcon className="size-4" />
          )}
          {isCreating
            ? 'Creating...'
            : isProcessing
              ? 'Generating...'
              : 'Export'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleExport('pdf')}>
          <FileTextIcon className="size-4" />
          Export as PDF
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport('docx')}>
          <FileIcon className="size-4" />
          Export as Word (DOCX)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

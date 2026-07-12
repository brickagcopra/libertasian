'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useScans } from '@/features/scans/hooks/use-scans';
import { useCanUploadDocuments } from '@/features/scans/hooks/use-upload-document';
import { UploadDocumentDialog } from '@/features/scans/components/upload-document-dialog';
import type { ProcessingStatus, ScanListItem } from '@/features/scans/types';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
  FileTextIcon,
  CameraIcon,
  AlertCircleIcon,
  SearchIcon,
  UploadIcon,
  LockIcon,
} from 'lucide-react';

const STATUS_BADGE_STYLES: Record<ProcessingStatus, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string }> = {
  completed: { variant: 'outline', className: 'border-green-200 bg-green-50 text-green-700' },
  processing: { variant: 'outline', className: 'border-yellow-200 bg-yellow-50 text-yellow-700' },
  pending: { variant: 'secondary' },
  failed: { variant: 'destructive' },
};

function ScanRow({ scan }: { scan: ScanListItem }) {
  const date = new Date(scan.createdAt).toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const badgeStyle = STATUS_BADGE_STYLES[scan.processingStatus] ?? STATUS_BADGE_STYLES.pending;

  return (
    <Link href={`/scans/${scan.id}`}>
      <Card className="transition-colors hover:border-border/80">
        <CardContent className="flex items-center gap-4 p-4">
          <div className="flex size-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <FileTextIcon className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {scan.originalFilename ?? `Scan ${scan.id.slice(0, 8)}`}
            </p>
            <p className="text-xs text-muted-foreground">{date}</p>
          </div>
          <div className="flex items-center gap-3">
            {scan.pageCount && (
              <span className="text-xs text-muted-foreground">{scan.pageCount} pg</span>
            )}
            <Badge variant={badgeStyle.variant} className={badgeStyle.className}>
              {scan.processingStatus}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function ScansPage() {
  const [statusFilter, setStatusFilter] = useState('all');
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const { allowed: canUpload, loading: uploadGateLoading } = useCanUploadDocuments();

  const { data, isLoading, error } = useScans({
    uploadType: 'all',
    ...(statusFilter !== 'all' && {
      processingStatus: statusFilter as ProcessingStatus,
    }),
  });

  const scans = data?.data ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Scans &amp; Uploads</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            View and manage your camera scans and document uploads
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/scans/search">
              <SearchIcon className="mr-1.5 h-4 w-4" />
              Search Uploads
            </Link>
          </Button>
          <Button
            size="sm"
            onClick={() => setShowUploadDialog(true)}
            disabled={uploadGateLoading}
            title={
              !uploadGateLoading && !canUpload
                ? 'Document uploads are available on Pro plans and above.'
                : undefined
            }
          >
            {!uploadGateLoading && !canUpload ? (
              <LockIcon className="mr-1.5 h-4 w-4" />
            ) : (
              <UploadIcon className="mr-1.5 h-4 w-4" />
            )}
            Upload document
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Label htmlFor="status-filter">Status:</Label>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]" id="status-filter">
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[72px] w-full rounded-lg" />
          ))}
        </div>
      ) : error ? (
        <Alert variant="destructive">
          <AlertCircleIcon className="size-4" />
          <AlertDescription>Failed to load scans. Please try again.</AlertDescription>
        </Alert>
      ) : scans.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <CameraIcon className="size-12 text-muted-foreground/50" />
            <h3 className="mt-3 text-sm font-semibold">No scans yet</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Use the mobile app to scan legal documents with your camera.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {scans.map((scan) => (
            <ScanRow key={scan.id} scan={scan} />
          ))}
        </div>
      )}

      <UploadDocumentDialog
        open={showUploadDialog}
        onOpenChange={setShowUploadDialog}
      />
    </div>
  );
}

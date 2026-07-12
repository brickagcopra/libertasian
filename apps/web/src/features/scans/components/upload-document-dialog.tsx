'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { CheckCircle2Icon, LockIcon, UploadIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { ApiClientError } from '@/lib/api-client';
import {
  ACCEPTED_UPLOAD_EXTENSIONS,
  useCanUploadDocuments,
  useUploadDocument,
  validateDocumentFile,
} from '../hooks/use-upload-document';

const UPGRADE_MESSAGE =
  'Document uploads are available on Pro plans and above.';

/**
 * Map an upload failure to a user-facing message.
 *
 * The XHR upload path does not attach the parsed error body to the thrown
 * ApiClientError, so on 403 we show a friendly upgrade message instead of
 * trying to read quota fields from the body.
 */
function uploadErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.statusCode === 403) return UPGRADE_MESSAGE;
    if (error.statusCode === 429) {
      return 'Too many uploads. Please wait a moment and try again.';
    }
    if (error.statusCode === 400) {
      return error.message || 'The file was rejected. Check the type and size.';
    }
  }
  return 'Upload failed. Please try again.';
}

export function UploadDocumentDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { allowed, loading: gateLoading } = useCanUploadDocuments();
  const upload = useUploadDocument();

  const [file, setFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploadedId, setUploadedId] = useState<string | null>(null);

  const resetAndClose = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setFile(null);
        setValidationError(null);
        setProgress(0);
        setUploadedId(null);
        upload.reset();
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange, upload],
  );

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    setFile(selected);
    setValidationError(selected ? validateDocumentFile(selected) : null);
  }, []);

  const handleUpload = useCallback(async () => {
    if (!file || validationError) return;
    setProgress(0);
    try {
      const res = await upload.mutateAsync({
        file,
        onProgress: setProgress,
      });
      setUploadedId(res.data.id);
    } catch {
      // Error surfaced via upload.error below
    }
  }, [file, validationError, upload]);

  const gated = !gateLoading && !allowed;

  return (
    <Dialog open={open} onOpenChange={resetAndClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload Document</DialogTitle>
        </DialogHeader>

        {gated ? (
          <div
            data-testid="upload-upgrade-hint"
            className="flex flex-col items-center gap-3 py-6 text-center"
          >
            <div className="flex size-10 items-center justify-center rounded-full bg-muted">
              <LockIcon className="size-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">{UPGRADE_MESSAGE}</p>
            <p className="text-xs text-muted-foreground">
              Upgrade to upload PDFs and images for OCR and digest generation.
            </p>
            <Button asChild size="sm">
              <Link href="/pricing">View plans &amp; upgrade</Link>
            </Button>
          </div>
        ) : uploadedId ? (
          <div
            data-testid="upload-success"
            className="space-y-3 rounded-lg border border-green-200 bg-green-50 p-4"
          >
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircle2Icon className="size-5" />
              <p className="text-sm font-semibold">Upload received</p>
            </div>
            <p className="text-sm text-green-700">
              Processing has started — your document now appears in the list
              below with a <span className="font-medium">pending</span> status
              while OCR runs.
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/scans/${uploadedId}`}>View upload</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="document-file">
                File <span className="text-destructive">*</span>
              </Label>
              <Input
                id="document-file"
                type="file"
                accept={ACCEPTED_UPLOAD_EXTENSIONS}
                onChange={handleFileChange}
                disabled={upload.isPending}
              />
              <p className="text-xs text-muted-foreground/70">
                PDF up to 50MB, or JPEG/PNG/WebP image up to 20MB.
              </p>
            </div>

            {validationError && (
              <p className="text-sm text-destructive">{validationError}</p>
            )}

            {upload.isPending && (
              <div className="space-y-1">
                <Progress value={progress} />
                <p className="text-xs text-muted-foreground">
                  Uploading… {progress}%
                </p>
              </div>
            )}

            {upload.error != null && !upload.isPending && (
              <p className="text-sm text-destructive">
                {uploadErrorMessage(upload.error)}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => resetAndClose(false)}
          >
            {uploadedId ? 'Done' : 'Cancel'}
          </Button>
          {!gated && !uploadedId && (
            <Button
              type="button"
              onClick={handleUpload}
              disabled={!file || !!validationError || upload.isPending}
            >
              <UploadIcon className="mr-1.5 size-4" />
              {upload.isPending ? 'Uploading…' : 'Upload'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

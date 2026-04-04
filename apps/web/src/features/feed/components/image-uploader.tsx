'use client';

import { useCallback, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ImageIcon, XIcon } from 'lucide-react';
import { useUploadFeedMedia, useFeedMediaStatus, useDeleteFeedMedia } from '../hooks/use-feed-media';
import { MediaProcessingBadge } from './media-processing-badge';

const ACCEPTED_TYPES = 'image/jpeg,image/png,image/webp';
const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20MB

interface ImageUploaderProps {
  mediaId: string | null;
  onMediaIdChange: (mediaId: string | null) => void;
}

export function ImageUploader({ mediaId, onMediaIdChange }: ImageUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const uploadMutation = useUploadFeedMedia();
  const deleteMutation = useDeleteFeedMedia();
  const { data: mediaStatus } = useFeedMediaStatus(mediaId);

  const processingStatus = mediaStatus?.data?.processingStatus;

  const handleFileSelect = useCallback(
    (file: File) => {
      setError(null);

      if (file.size > MAX_SIZE_BYTES) {
        setError('Image must be under 20MB.');
        return;
      }

      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        setError('Only JPEG, PNG, and WebP images are allowed.');
        return;
      }

      const objectUrl = URL.createObjectURL(file);
      setPreviewUrl(objectUrl);
      setUploadProgress(0);

      uploadMutation.mutate(
        { file, onProgress: setUploadProgress },
        {
          onSuccess: (res) => {
            onMediaIdChange(res.data.mediaId);
          },
          onError: (err) => {
            setError((err as Error).message || 'Upload failed.');
            setPreviewUrl(null);
            URL.revokeObjectURL(objectUrl);
          },
        },
      );
    },
    [uploadMutation, onMediaIdChange],
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
    e.target.value = '';
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect],
  );

  const handleRemove = () => {
    if (mediaId) {
      deleteMutation.mutate(mediaId);
    }
    onMediaIdChange(null);
    setPreviewUrl(null);
    setUploadProgress(0);
    setError(null);
  };

  if (previewUrl || mediaId) {
    return (
      <div className="space-y-2">
        <div className="relative overflow-hidden rounded-lg border">
          {previewUrl && (
            <img src={previewUrl} alt="Upload preview" className="max-h-64 w-full object-cover" />
          )}
          <Button
            variant="destructive"
            size="icon"
            className="absolute right-2 top-2 size-7"
            onClick={handleRemove}
          >
            <XIcon className="size-4" />
          </Button>
        </div>

        {uploadMutation.isPending && (
          <Progress value={uploadProgress} className="h-1.5" />
        )}

        {processingStatus && processingStatus !== 'ready' && (
          <MediaProcessingBadge
            status={processingStatus}
            failureReason={mediaStatus?.data?.failureReason}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div
        className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors hover:border-primary/50 hover:bg-muted/50"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        <ImageIcon className="mb-2 size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Click or drag an image here</p>
        <p className="text-xs text-muted-foreground">JPEG, PNG, or WebP up to 20MB</p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        className="hidden"
        onChange={handleInputChange}
      />

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

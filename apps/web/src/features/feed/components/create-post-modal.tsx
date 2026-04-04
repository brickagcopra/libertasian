'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ImageIcon } from 'lucide-react';
import { useCreatePost } from '../hooks/use-create-post';
import { useFeedMediaStatus } from '../hooks/use-feed-media';
import { ImageUploader } from './image-uploader';
import type { FeedPostVisibility } from '@libertasian/types';

interface CreatePostModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MAX_TEXT_LENGTH = 5000;

export function CreatePostModal({ open, onOpenChange }: CreatePostModalProps) {
  const [textContent, setTextContent] = useState('');
  const [visibility, setVisibility] = useState<FeedPostVisibility>('organization');
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [showImageUploader, setShowImageUploader] = useState(false);

  const createPost = useCreatePost();
  const { data: mediaStatus } = useFeedMediaStatus(mediaId);

  const mediaReady = !mediaId || mediaStatus?.data?.processingStatus === 'ready';
  const hasContent = textContent.trim().length > 0 || mediaId;
  const canSubmit = hasContent && mediaReady && !createPost.isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    createPost.mutate(
      {
        textContent: textContent.trim(),
        visibility,
        mediaId: mediaId ?? undefined,
      },
      {
        onSuccess: () => {
          setTextContent('');
          setVisibility('organization');
          setMediaId(null);
          setShowImageUploader(false);
          onOpenChange(false);
        },
      },
    );
  };

  const handleClose = (value: boolean) => {
    if (!createPost.isPending) {
      onOpenChange(value);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Post</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Textarea
              placeholder="What's on your mind?"
              value={textContent}
              onChange={(e) => setTextContent(e.target.value)}
              maxLength={MAX_TEXT_LENGTH}
              rows={4}
              className="resize-none"
            />
            <div className="flex justify-end">
              <span className="text-xs text-muted-foreground">
                {textContent.length}/{MAX_TEXT_LENGTH}
              </span>
            </div>
          </div>

          {showImageUploader && (
            <ImageUploader mediaId={mediaId} onMediaIdChange={setMediaId} />
          )}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {!showImageUploader && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setShowImageUploader(true)}
                >
                  <ImageIcon className="size-4" />
                  Image
                </Button>
              )}

              <Select
                value={visibility}
                onValueChange={(v) => setVisibility(v as FeedPostVisibility)}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="organization">Organization</SelectItem>
                  <SelectItem value="public">Public</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button onClick={handleSubmit} disabled={!canSubmit}>
              {createPost.isPending ? 'Posting...' : 'Post'}
            </Button>
          </div>

          {createPost.error && (
            <Alert variant="destructive">
              <AlertDescription>
                {(createPost.error as Error).message || 'Failed to create post.'}
              </AlertDescription>
            </Alert>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

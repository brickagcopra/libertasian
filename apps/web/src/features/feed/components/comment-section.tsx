'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { HeartIcon, ReplyIcon, PencilIcon, TrashIcon, LoaderIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import {
  useComments,
  useCreateComment,
  useUpdateComment,
  useDeleteComment,
  useLikeComment,
  useUnlikeComment,
} from '../hooks/use-feed-comments';
import type { FeedCommentItem } from '@libertasian/types';

interface CommentSectionProps {
  postId: string;
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

function CommentItem({
  comment,
  postId,
  depth = 0,
}: {
  comment: FeedCommentItem;
  postId: string;
  depth?: number;
}) {
  const user = useAuthStore((s) => s.user);
  const [replyOpen, setReplyOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editText, setEditText] = useState(comment.textContent);
  const [replyText, setReplyText] = useState('');

  const createComment = useCreateComment();
  const updateComment = useUpdateComment();
  const deleteComment = useDeleteComment();
  const likeComment = useLikeComment();
  const unlikeComment = useUnlikeComment();

  const isOwner = user?.id === comment.author.id;

  const handleLike = () => {
    if (comment.isLikedByMe) {
      unlikeComment.mutate(comment.id);
    } else {
      likeComment.mutate(comment.id);
    }
  };

  const handleReply = () => {
    if (!replyText.trim()) return;
    createComment.mutate(
      { postId, textContent: replyText.trim(), parentId: comment.id },
      {
        onSuccess: () => {
          setReplyText('');
          setReplyOpen(false);
        },
      },
    );
  };

  const handleEdit = () => {
    if (!editText.trim()) return;
    updateComment.mutate(
      { commentId: comment.id, textContent: editText.trim() },
      { onSuccess: () => setEditOpen(false) },
    );
  };

  const handleDelete = () => {
    if (window.confirm('Delete this comment?')) {
      deleteComment.mutate(comment.id);
    }
  };

  return (
    <div className={cn('space-y-2', depth > 0 && 'ml-8 border-l pl-4')}>
      <div className="flex gap-2.5">
        <Avatar className="size-7 shrink-0">
          <AvatarFallback className="text-[10px]">
            {getInitials(comment.author.fullName)}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="rounded-lg bg-muted px-3 py-2">
            <p className="text-xs font-semibold">{comment.author.fullName}</p>
            {editOpen ? (
              <div className="mt-1 space-y-2">
                <Textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  className="resize-none text-sm"
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleEdit} disabled={updateComment.isPending}>
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditOpen(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm whitespace-pre-wrap">{comment.textContent}</p>
            )}
          </div>

          <div className="mt-1 flex items-center gap-3 px-1">
            <button
              className={cn(
                'text-xs text-muted-foreground hover:text-foreground',
                comment.isLikedByMe && 'font-medium text-red-500',
              )}
              onClick={handleLike}
            >
              {comment.likeCount > 0 ? `${comment.likeCount} Like${comment.likeCount > 1 ? 's' : ''}` : 'Like'}
            </button>
            {depth === 0 && (
              <button
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setReplyOpen((v) => !v)}
              >
                Reply
              </button>
            )}
            {isOwner && (
              <>
                <button
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setEditOpen(true)}
                >
                  Edit
                </button>
                <button
                  className="text-xs text-muted-foreground hover:text-destructive"
                  onClick={handleDelete}
                >
                  Delete
                </button>
              </>
            )}
            <span className="text-xs text-muted-foreground">
              {formatRelativeTime(comment.createdAt)}
              {comment.editedAt && ' (edited)'}
            </span>
          </div>

          {replyOpen && (
            <div className="mt-2 flex gap-2">
              <Textarea
                placeholder="Write a reply..."
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                rows={1}
                maxLength={2000}
                className="resize-none text-sm"
              />
              <Button size="sm" onClick={handleReply} disabled={createComment.isPending}>
                Reply
              </Button>
            </div>
          )}
        </div>
      </div>

      {comment.replies?.map((reply) => (
        <CommentItem key={reply.id} comment={reply} postId={postId} depth={1} />
      ))}
    </div>
  );
}

export function CommentSection({ postId }: CommentSectionProps) {
  const [newComment, setNewComment] = useState('');
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useComments(postId);
  const createComment = useCreateComment();

  const comments = data?.pages.flatMap((p) => p.data) ?? [];

  const handleSubmit = () => {
    if (!newComment.trim()) return;
    createComment.mutate(
      { postId, textContent: newComment.trim() },
      { onSuccess: () => setNewComment('') },
    );
  };

  return (
    <div className="space-y-4 border-t pt-4">
      <div className="flex gap-2">
        <Textarea
          placeholder="Write a comment..."
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          rows={1}
          maxLength={2000}
          className="resize-none text-sm"
        />
        <Button onClick={handleSubmit} disabled={!newComment.trim() || createComment.isPending}>
          Post
        </Button>
      </div>

      {isLoading && (
        <div className="flex justify-center py-4">
          <LoaderIcon className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}

      <div className="space-y-3">
        {comments.map((comment) => (
          <CommentItem key={comment.id} comment={comment} postId={postId} />
        ))}
      </div>

      {hasNextPage && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
        >
          {isFetchingNextPage ? 'Loading...' : 'Load more comments'}
        </Button>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreHorizontalIcon, PencilIcon, TrashIcon, FlagIcon } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useDeletePost } from '../hooks/use-delete-post';
import { ReportDialog } from './report-dialog';

interface PostMenuProps {
  postId: string;
  authorId: string;
  onEdit?: () => void;
}

export function PostMenu({ postId, authorId, onEdit }: PostMenuProps) {
  const user = useAuthStore((s) => s.user);
  const deletePost = useDeletePost();
  const [reportOpen, setReportOpen] = useState(false);

  const isOwner = user?.id === authorId;

  const handleDelete = () => {
    if (window.confirm('Are you sure you want to delete this post?')) {
      deletePost.mutate(postId);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8">
            <MoreHorizontalIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {isOwner && (
            <>
              {onEdit && (
                <DropdownMenuItem onClick={onEdit}>
                  <PencilIcon className="mr-2 size-4" />
                  Edit
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={handleDelete}
              >
                <TrashIcon className="mr-2 size-4" />
                Delete
              </DropdownMenuItem>
            </>
          )}
          {!isOwner && (
            <DropdownMenuItem onClick={() => setReportOpen(true)}>
              <FlagIcon className="mr-2 size-4" />
              Report
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ReportDialog postId={postId} open={reportOpen} onOpenChange={setReportOpen} />
    </>
  );
}

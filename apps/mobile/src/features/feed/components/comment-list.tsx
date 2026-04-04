import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { FeedCommentItem } from '@libertasian/types';
import {
  useComments,
  useUpdateComment,
  useDeleteComment,
  useLikeComment,
  useUnlikeComment,
} from '../hooks/use-feed-comments';
import { CommentInput } from './comment-input';

interface CommentListProps {
  postId: string;
}

export function CommentList({ postId }: CommentListProps) {
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useComments(postId);

  const comments = data?.pages.flatMap((p) => p.data) ?? [];

  const renderComment = useCallback(
    ({ item }: { item: FeedCommentItem }) => (
      <CommentRow comment={item} postId={postId} />
    ),
    [postId],
  );

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color="#1a56db" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={comments}
        renderItem={renderComment}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        onEndReached={() => { if (hasNextPage) fetchNextPage(); }}
        onEndReachedThreshold={0.3}
        ListFooterComponent={
          isFetchingNextPage ? (
            <ActivityIndicator size="small" color="#1a56db" style={styles.footer} />
          ) : null
        }
        ListEmptyComponent={
          <Text style={styles.emptyText}>No comments yet. Be the first to comment!</Text>
        }
      />
      <CommentInput postId={postId} />
    </View>
  );
}

function CommentRow({ comment, postId }: { comment: FeedCommentItem; postId: string }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(comment.textContent);
  const [showReplies, setShowReplies] = useState(false);
  const [replyingTo, setReplyingTo] = useState(false);

  const updateComment = useUpdateComment();
  const deleteComment = useDeleteComment();
  const likeComment = useLikeComment();
  const unlikeComment = useUnlikeComment();

  const handleSaveEdit = useCallback(() => {
    const trimmed = editText.trim();
    if (!trimmed) return;
    updateComment.mutate(
      { commentId: comment.id, textContent: trimmed },
      { onSuccess: () => setIsEditing(false) },
    );
  }, [editText, comment.id, updateComment]);

  const handleDelete = useCallback(() => {
    Alert.alert('Delete Comment', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteComment.mutate(comment.id) },
    ]);
  }, [comment.id, deleteComment]);

  const handleLikeToggle = useCallback(() => {
    if (comment.isLikedByMe) {
      unlikeComment.mutate(comment.id);
    } else {
      likeComment.mutate(comment.id);
    }
  }, [comment.id, comment.isLikedByMe, likeComment, unlikeComment]);

  const timeAgo = formatTimeAgo(comment.createdAt);

  return (
    <View style={styles.commentRow}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{comment.author.fullName.charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.commentBody}>
        <View style={styles.commentBubble}>
          <Text style={styles.authorName}>{comment.author.fullName}</Text>
          {isEditing ? (
            <View>
              <TextInput
                style={styles.editInput}
                value={editText}
                onChangeText={setEditText}
                multiline
                maxLength={2000}
              />
              <View style={styles.editActions}>
                <TouchableOpacity onPress={() => setIsEditing(false)}>
                  <Text style={styles.editCancel}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleSaveEdit} disabled={updateComment.isPending}>
                  <Text style={styles.editSave}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <Text style={styles.commentText}>{comment.textContent}</Text>
          )}
        </View>

        <View style={styles.commentMeta}>
          <Text style={styles.metaText}>{timeAgo}</Text>
          {comment.editedAt && <Text style={styles.metaText}>(edited)</Text>}

          <TouchableOpacity onPress={handleLikeToggle} style={styles.metaAction}>
            <Text style={[styles.metaText, comment.isLikedByMe && styles.metaActive]}>
              {comment.isLikedByMe ? 'Liked' : 'Like'}
            </Text>
            {comment.likeCount > 0 && (
              <Text style={styles.metaText}> {comment.likeCount}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setReplyingTo(!replyingTo)} style={styles.metaAction}>
            <Text style={styles.metaText}>Reply</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setIsEditing(true)} style={styles.metaAction}>
            <Ionicons name="create-outline" size={12} color="#9ca3af" />
          </TouchableOpacity>

          <TouchableOpacity onPress={handleDelete} style={styles.metaAction}>
            <Ionicons name="trash-outline" size={12} color="#9ca3af" />
          </TouchableOpacity>
        </View>

        {comment.replies && comment.replies.length > 0 && (
          <View style={styles.repliesSection}>
            {showReplies ? (
              comment.replies.map((reply) => (
                <CommentRow key={reply.id} comment={reply} postId={postId} />
              ))
            ) : (
              <TouchableOpacity onPress={() => setShowReplies(true)}>
                <Text style={styles.viewReplies}>
                  View {comment.totalReplyCount ?? comment.replies.length} {(comment.totalReplyCount ?? comment.replies.length) === 1 ? 'reply' : 'replies'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {replyingTo && (
          <CommentInput
            postId={postId}
            parentId={comment.id}
            placeholder={`Reply to ${comment.author.fullName}...`}
            onSubmitted={() => setReplyingTo(false)}
          />
        )}
      </View>
    </View>
  );
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(dateStr).toLocaleDateString();
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    padding: 24,
    alignItems: 'center',
  },
  listContent: {
    padding: 14,
    gap: 12,
  },
  footer: {
    padding: 12,
  },
  emptyText: {
    fontSize: 13,
    color: '#9ca3af',
    textAlign: 'center',
    paddingVertical: 24,
  },
  commentRow: {
    flexDirection: 'row',
    gap: 8,
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#e5e7eb',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
  },
  commentBody: {
    flex: 1,
  },
  commentBubble: {
    backgroundColor: '#f3f4f6',
    borderRadius: 12,
    padding: 10,
  },
  authorName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 2,
  },
  commentText: {
    fontSize: 13,
    color: '#374151',
    lineHeight: 18,
  },
  editInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 8,
    fontSize: 13,
    color: '#111827',
    marginTop: 4,
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 6,
  },
  editCancel: {
    fontSize: 12,
    color: '#6b7280',
  },
  editSave: {
    fontSize: 12,
    color: '#1a56db',
    fontWeight: '600',
  },
  commentMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
    paddingLeft: 4,
  },
  metaText: {
    fontSize: 11,
    color: '#9ca3af',
  },
  metaActive: {
    color: '#dc2626',
    fontWeight: '500',
  },
  metaAction: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  repliesSection: {
    marginTop: 8,
    marginLeft: 4,
  },
  viewReplies: {
    fontSize: 12,
    color: '#1a56db',
    fontWeight: '500',
  },
});

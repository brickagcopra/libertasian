import React, { useCallback } from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { FeedPostItem } from '@libertasian/types';
import { useLikePost, useUnlikePost, useBookmarkPost, useUnbookmarkPost } from '../hooks/use-feed-interactions';

interface PostActionsBarProps {
  post: FeedPostItem;
  onCommentPress: () => void;
  onOptionsPress: () => void;
}

export function PostActionsBar({ post, onCommentPress, onOptionsPress }: PostActionsBarProps) {
  const likePost = useLikePost();
  const unlikePost = useUnlikePost();
  const bookmarkPost = useBookmarkPost();
  const unbookmarkPost = useUnbookmarkPost();

  const handleLikeToggle = useCallback(() => {
    if (post.isLikedByMe) {
      unlikePost.mutate(post.id);
    } else {
      likePost.mutate(post.id);
    }
  }, [post.id, post.isLikedByMe, likePost, unlikePost]);

  const handleBookmarkToggle = useCallback(() => {
    if (post.isBookmarkedByMe) {
      unbookmarkPost.mutate(post.id);
    } else {
      bookmarkPost.mutate(post.id);
    }
  }, [post.id, post.isBookmarkedByMe, bookmarkPost, unbookmarkPost]);

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.action} onPress={handleLikeToggle}>
        <Ionicons
          name={post.isLikedByMe ? 'heart' : 'heart-outline'}
          size={20}
          color={post.isLikedByMe ? '#dc2626' : '#6b7280'}
        />
        {post.likeCount > 0 && (
          <Text style={[styles.count, post.isLikedByMe && styles.countActive]}>{post.likeCount}</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.action} onPress={onCommentPress}>
        <Ionicons name="chatbubble-outline" size={19} color="#6b7280" />
        {post.commentCount > 0 && (
          <Text style={styles.count}>{post.commentCount}</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.action} onPress={handleBookmarkToggle}>
        <Ionicons
          name={post.isBookmarkedByMe ? 'bookmark' : 'bookmark-outline'}
          size={19}
          color={post.isBookmarkedByMe ? '#1a56db' : '#6b7280'}
        />
        {post.bookmarkCount > 0 && (
          <Text style={[styles.count, post.isBookmarkedByMe && styles.countBookmark]}>{post.bookmarkCount}</Text>
        )}
      </TouchableOpacity>

      <View style={styles.spacer} />

      <TouchableOpacity
        style={styles.action}
        onPress={onOptionsPress}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="ellipsis-horizontal" size={18} color="#6b7280" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
    marginTop: 10,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  count: {
    fontSize: 13,
    color: '#6b7280',
    fontWeight: '500',
  },
  countActive: {
    color: '#dc2626',
  },
  countBookmark: {
    color: '#1a56db',
  },
  spacer: {
    flex: 1,
  },
});

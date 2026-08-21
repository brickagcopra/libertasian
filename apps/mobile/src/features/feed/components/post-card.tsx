import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { FeedPostItem } from '@libertasian/types';
import { PostActionsBar } from './post-actions-bar';
import { PostOptionsSheet } from './post-options-sheet';
import { ReportSheet } from './report-sheet';

interface PostCardProps {
  post: FeedPostItem;
  currentUserId?: string;
}

const TEXT_TRUNCATE_LENGTH = 300;

const VISIBILITY_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  public: { icon: 'earth-outline', label: 'Public', color: '#059669' },
  organization: { icon: 'people-outline', label: 'Organization', color: '#1a56db' },
  draft: { icon: 'document-outline', label: 'Draft', color: '#9ca3af' },
};

export function PostCard({ post, currentUserId }: PostCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [showReport, setShowReport] = useState(false);

  const isOwner = currentUserId === post.author.id;
  const visConfig = VISIBILITY_CONFIG[post.visibility] ?? VISIBILITY_CONFIG['organization'];
  const timeAgo = useMemo(() => formatTimeAgo(post.createdAt), [post.createdAt]);

  const textContent = post.textContent ?? '';
  const shouldTruncate = textContent.length > TEXT_TRUNCATE_LENGTH && !expanded;
  const displayText = shouldTruncate
    ? textContent.slice(0, TEXT_TRUNCATE_LENGTH) + '...'
    : textContent;

  const mediaImageUrl = post.media?.processingStatus === 'ready' && post.media.thumbnailObjectKey
    ? post.media.thumbnailObjectKey
    : null;

  const handleCommentPress = useCallback(() => {
    router.push(`/feed/${post.id}`);
  }, [post.id]);

  const handleEdit = useCallback(() => {
    router.push(`/feed/create?editPostId=${post.id}`);
  }, [post.id]);

  const handleAuthorPress = useCallback(() => {
    router.push(`/feed/user/${post.author.id}`);
  }, [post.author.id]);

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.avatar} onPress={handleAuthorPress}>
          <Text style={styles.avatarText}>{post.author.fullName.charAt(0).toUpperCase()}</Text>
        </TouchableOpacity>
        <View style={styles.headerText}>
          <TouchableOpacity onPress={handleAuthorPress}>
            <Text style={styles.authorName}>{post.author.fullName}</Text>
          </TouchableOpacity>
          <View style={styles.headerMeta}>
            <Text style={styles.timeText}>{timeAgo}</Text>
            <Ionicons name={visConfig.icon as keyof typeof Ionicons.glyphMap} size={12} color={visConfig.color} />
            {post.isPinned && (
              <Ionicons name="pin" size={12} color="#d97706" />
            )}
            {post.editedAt && (
              <Text style={styles.editedText}>(edited)</Text>
            )}
          </View>
        </View>
      </View>

      {/* Text content */}
      {textContent.length > 0 && (
        <View style={styles.textContainer}>
          <Text style={styles.textContent}>{displayText}</Text>
          {shouldTruncate && (
            <TouchableOpacity onPress={() => setExpanded(true)}>
              <Text style={styles.readMore}>Read more</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Media */}
      {mediaImageUrl && post.media && (
        <TouchableOpacity
          style={styles.mediaContainer}
          onPress={handleCommentPress}
          activeOpacity={0.9}
        >
          <Image
            source={{ uri: mediaImageUrl }}
            style={[
              styles.mediaImage,
              {
                aspectRatio:
                  post.media.width && post.media.height
                    ? post.media.width / post.media.height
                    : 16 / 9,
              },
            ]}
            resizeMode="cover"
          />
        </TouchableOpacity>
      )}

      {/* Actions */}
      <PostActionsBar
        post={post}
        onCommentPress={handleCommentPress}
        onOptionsPress={() => setShowOptions(true)}
      />

      {/* Sheets */}
      <PostOptionsSheet
        visible={showOptions}
        post={post}
        isOwner={isOwner}
        onClose={() => setShowOptions(false)}
        onEdit={handleEdit}
        onReport={() => setShowReport(true)}
      />
      <ReportSheet
        visible={showReport}
        postId={post.id}
        onClose={() => setShowReport(false)}
      />
    </View>
  );
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(dateStr).toLocaleDateString();
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#e5e7eb',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6b7280',
  },
  headerText: {
    marginLeft: 10,
    flex: 1,
  },
  authorName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  headerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  timeText: {
    fontSize: 11,
    color: '#9ca3af',
  },
  editedText: {
    fontSize: 11,
    color: '#9ca3af',
    fontStyle: 'italic',
  },
  textContainer: {
    marginTop: 10,
  },
  textContent: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
  },
  readMore: {
    fontSize: 13,
    color: '#1a56db',
    fontWeight: '500',
    marginTop: 4,
  },
  mediaContainer: {
    marginTop: 10,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#f3f4f6',
  },
  mediaImage: {
    width: '100%',
  },
});

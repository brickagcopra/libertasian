import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, Image, StyleSheet } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { usePostDetail } from '../../../features/feed/hooks/use-feed';
import { PostActionsBar } from '../../../features/feed/components/post-actions-bar';
import { PostOptionsSheet } from '../../../features/feed/components/post-options-sheet';
import { ReportSheet } from '../../../features/feed/components/report-sheet';
import { CommentList } from '../../../features/feed/components/comment-list';
import { useAuth } from '../../../providers/auth-provider';

export default function PostDetailScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const { data, isLoading } = usePostDetail(postId ?? '');
  const { user } = useAuth();
  const [showOptions, setShowOptions] = useState(false);
  const [showReport, setShowReport] = useState(false);

  const post = data?.data;

  const timeFormatted = useMemo(() => {
    if (!post) return '';
    return new Date(post.createdAt).toLocaleString();
  }, [post]);

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#1a56db" />
      </View>
    );
  }

  if (!post) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="alert-circle-outline" size={48} color="#d1d5db" />
        <Text style={styles.errorTitle}>Post not found</Text>
        <Text style={styles.errorMessage}>This post may have been deleted or is no longer available.</Text>
      </View>
    );
  }

  const mediaImageUrl =
    post.media?.processingStatus === 'ready' && post.media.processedObjectKey
      ? post.media.processedObjectKey
      : null;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Post' }} />

      <View style={styles.postSection}>
        <ScrollView style={styles.postScroll} contentContainerStyle={styles.postContent}>
          {/* Author header */}
          <View style={styles.header}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{post.author.fullName.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={styles.headerText}>
              <Text style={styles.authorName}>{post.author.fullName}</Text>
              <Text style={styles.timeText}>{timeFormatted}</Text>
            </View>
          </View>

          {/* Text content */}
          {post.textContent && (
            <Text style={styles.textContent}>{post.textContent}</Text>
          )}

          {/* Media */}
          {mediaImageUrl && post.media && (
            <View style={styles.mediaContainer}>
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
                resizeMode="contain"
              />
            </View>
          )}

          {/* Actions */}
          {/*
            No onCommentPress here: the comments are already rendered below,
            so the count shows as plain text rather than a button with
            nowhere to go. onOptionsPress opens the real sheet — it was
            previously wired to a no-op, leaving a visible but dead
            moderation control on this screen.
          */}
          <PostActionsBar
            post={post}
            onOptionsPress={() => setShowOptions(true)}
          />
        </ScrollView>
      </View>

      {/* Comments section */}
      <View style={styles.commentsSection}>
        <Text style={styles.commentsTitle}>
          Comments {post.commentCount > 0 ? `(${post.commentCount})` : ''}
        </Text>
        <CommentList postId={post.id} />
      </View>

      {/* Sheets */}
      <PostOptionsSheet
        visible={showOptions}
        post={post}
        isOwner={user?.id === post.author.id}
        onClose={() => setShowOptions(false)}
        onEdit={() => router.push(`/feed/create?editPostId=${post.id}` as `/${string}`)}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 8,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6b7280',
    marginTop: 8,
  },
  errorMessage: {
    fontSize: 13,
    color: '#9ca3af',
    textAlign: 'center',
  },
  postSection: {
    backgroundColor: '#fff',
    maxHeight: '50%',
  },
  postScroll: {
    flexGrow: 0,
  },
  postContent: {
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e5e7eb',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6b7280',
  },
  headerText: {
    marginLeft: 12,
  },
  authorName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  timeText: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
  textContent: {
    fontSize: 15,
    color: '#374151',
    lineHeight: 22,
    marginTop: 14,
  },
  mediaContainer: {
    marginTop: 14,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#f3f4f6',
  },
  mediaImage: {
    width: '100%',
  },
  commentsSection: {
    flex: 1,
    backgroundColor: '#fff',
    marginTop: 8,
  },
  commentsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
  },
});

import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  useWindowDimensions,
  StyleSheet,
} from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useBlogPost } from '../../features/blog/hooks/use-blog';

/**
 * Strip HTML tags for plain-text rendering on mobile.
 * A full WebView could be used for rich HTML, but plain text
 * is lighter and avoids the WebView dependency for simple blog content.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '  \u2022 ')
    .replace(/<\/blockquote>/gi, '\n')
    .replace(/<blockquote[^>]*>/gi, '\n> ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export default function BlogPostScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { data, isLoading, error } = useBlogPost(slug ?? '');
  const { width } = useWindowDimensions();

  const post = data?.data;

  const publishedDate = useMemo(() => {
    if (!post?.publishedAt) return '';
    return new Date(post.publishedAt).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }, [post?.publishedAt]);

  const plainContent = useMemo(() => {
    if (!post?.content) return '';
    return stripHtml(post.content);
  }, [post?.content]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/blog');
    }
  }, []);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <Stack.Screen options={{ title: 'Loading...' }} />
        <ActivityIndicator size="large" color="#1a56db" />
      </View>
    );
  }

  if (error || !post) {
    return (
      <View style={styles.errorContainer}>
        <Stack.Screen options={{ title: 'Error' }} />
        <Ionicons name="alert-circle-outline" size={48} color="#d1d5db" />
        <Text style={styles.errorTitle}>Post not found</Text>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <Text style={styles.backButtonText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <Stack.Screen options={{ title: 'Blog' }} />

      {/* Cover Image */}
      {post.coverImageUrl && (
        <Image
          source={{ uri: post.coverImageUrl }}
          style={[styles.coverImage, { width }]}
          resizeMode="cover"
        />
      )}

      <View style={styles.body}>
        {/* Tags */}
        {post.tags.length > 0 && (
          <View style={styles.tags}>
            {post.tags.map((tag) => (
              <View
                key={tag.id}
                style={[
                  styles.tag,
                  tag.color ? { backgroundColor: `${tag.color}15` } : undefined,
                ]}
              >
                <Text
                  style={[
                    styles.tagText,
                    tag.color ? { color: tag.color } : undefined,
                  ]}
                >
                  {tag.name}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Title */}
        <Text style={styles.title}>{post.title}</Text>

        {/* Meta */}
        <View style={styles.meta}>
          <View style={styles.authorAvatar}>
            <Text style={styles.authorAvatarText}>
              {post.author.fullName.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View>
            <Text style={styles.authorName}>{post.author.fullName}</Text>
            <View style={styles.metaRow}>
              <Text style={styles.metaText}>{publishedDate}</Text>
              {post.readTimeMinutes && (
                <>
                  <Text style={styles.metaDot}>&middot;</Text>
                  <Text style={styles.metaText}>{post.readTimeMinutes} min read</Text>
                </>
              )}
            </View>
          </View>
        </View>

        {/* Content */}
        <Text style={styles.content}>{plainContent}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  contentContainer: {
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    gap: 12,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6b7280',
  },
  backButton: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#1a56db',
  },
  backButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  coverImage: {
    height: 220,
  },
  body: {
    padding: 20,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  tag: {
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#6b7280',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111827',
    lineHeight: 32,
    letterSpacing: -0.3,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 24,
    gap: 10,
  },
  authorAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#e5e7eb',
    justifyContent: 'center',
    alignItems: 'center',
  },
  authorAvatarText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6b7280',
  },
  authorName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 1,
  },
  metaText: {
    fontSize: 12,
    color: '#9ca3af',
  },
  metaDot: {
    fontSize: 12,
    color: '#9ca3af',
  },
  content: {
    fontSize: 16,
    color: '#374151',
    lineHeight: 26,
  },
});

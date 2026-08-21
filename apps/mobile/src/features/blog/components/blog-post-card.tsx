import React, { useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { BlogPost } from '../types';

interface BlogPostCardProps {
  post: BlogPost;
}

export function BlogPostCard({ post }: BlogPostCardProps) {
  const publishedDate = useMemo(() => {
    if (!post.publishedAt) return '';
    return new Date(post.publishedAt).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }, [post.publishedAt]);

  const handlePress = useCallback(() => {
    router.push(`/blog/${post.slug}`);
  }, [post.slug]);

  return (
    <TouchableOpacity style={styles.card} onPress={handlePress} activeOpacity={0.7}>
      {/* Cover Image */}
      <View style={styles.imageContainer}>
        {post.coverImageUrl ? (
          <Image
            source={{ uri: post.coverImageUrl }}
            style={styles.image}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.imagePlaceholder}>
            <Ionicons name="document-text-outline" size={32} color="#d1d5db" />
          </View>
        )}
      </View>

      {/* Content */}
      <View style={styles.content}>
        {/* Tags */}
        {post.tags.length > 0 && (
          <View style={styles.tags}>
            {post.tags.slice(0, 2).map((tag) => (
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

        <Text style={styles.title} numberOfLines={2}>
          {post.title}
        </Text>

        {post.excerpt && (
          <Text style={styles.excerpt} numberOfLines={2}>
            {post.excerpt}
          </Text>
        )}

        {/* Meta */}
        <View style={styles.meta}>
          <Text style={styles.author}>{post.author.fullName}</Text>
          <Text style={styles.dot}>&middot;</Text>
          <Text style={styles.date}>{publishedDate}</Text>
          {post.readTimeMinutes && (
            <>
              <Text style={styles.dot}>&middot;</Text>
              <Text style={styles.readTime}>{post.readTimeMinutes} min</Text>
            </>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  imageContainer: {
    height: 160,
    backgroundColor: '#f3f4f6',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
  },
  content: {
    padding: 14,
  },
  tags: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
  },
  tag: {
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  tagText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#6b7280',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    lineHeight: 22,
  },
  excerpt: {
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 18,
    marginTop: 4,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 4,
  },
  author: {
    fontSize: 12,
    fontWeight: '500',
    color: '#374151',
  },
  dot: {
    fontSize: 12,
    color: '#9ca3af',
  },
  date: {
    fontSize: 12,
    color: '#9ca3af',
  },
  readTime: {
    fontSize: 12,
    color: '#9ca3af',
  },
});

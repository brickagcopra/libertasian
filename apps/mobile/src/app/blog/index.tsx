import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { Stack } from 'expo-router';
import { useBlogPosts, useBlogTags } from '../../features/blog/hooks/use-blog';
import { BlogList } from '../../features/blog/components/blog-list';
import type { BlogTag } from '../../features/blog/types';

export default function BlogScreen() {
  const [selectedTag, setSelectedTag] = useState<string | undefined>(undefined);

  const tagsQuery = useBlogTags();
  const postsQuery = useBlogPosts(selectedTag);

  const posts = postsQuery.data?.pages.flatMap((p) => p.data) ?? [];
  // `GET /blog/tags` returns a bare { success, data } envelope, already
  // stripped by `apiClient` — so the query data IS the tag array.
  const tags: BlogTag[] = tagsQuery.data ?? [];

  const handleRefresh = useCallback(() => {
    postsQuery.refetch();
    tagsQuery.refetch();
  }, [postsQuery, tagsQuery]);

  const handleTagPress = useCallback((tagSlug: string) => {
    setSelectedTag((prev) => (prev === tagSlug ? undefined : tagSlug));
  }, []);

  const TagFilter = useCallback(() => {
    if (tags.length === 0) return null;
    return (
      <View style={styles.tagFilterContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tagScroll}
        >
          <TouchableOpacity
            style={[styles.tagChip, !selectedTag && styles.tagChipActive]}
            onPress={() => setSelectedTag(undefined)}
          >
            <Text style={[styles.tagChipText, !selectedTag && styles.tagChipTextActive]}>
              All
            </Text>
          </TouchableOpacity>
          {tags.map((tag) => (
            <TouchableOpacity
              key={tag.id}
              style={[styles.tagChip, selectedTag === tag.slug && styles.tagChipActive]}
              onPress={() => handleTagPress(tag.slug)}
            >
              <Text
                style={[
                  styles.tagChipText,
                  selectedTag === tag.slug && styles.tagChipTextActive,
                ]}
              >
                {tag.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  }, [tags, selectedTag, handleTagPress]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Blog' }} />

      <BlogList
        posts={posts}
        isLoading={postsQuery.isLoading}
        isFetchingNextPage={postsQuery.isFetchingNextPage}
        hasNextPage={!!postsQuery.hasNextPage}
        isRefreshing={postsQuery.isRefetching && !postsQuery.isFetchingNextPage}
        fetchNextPage={() => postsQuery.fetchNextPage()}
        onRefresh={handleRefresh}
        ListHeaderComponent={TagFilter}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  tagFilterContainer: {
    marginBottom: 4,
  },
  tagScroll: {
    paddingVertical: 4,
    gap: 8,
  },
  tagChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  tagChipActive: {
    backgroundColor: '#1a56db',
    borderColor: '#1a56db',
  },
  tagChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#6b7280',
  },
  tagChipTextActive: {
    color: '#fff',
  },
});

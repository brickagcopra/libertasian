import { useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { TabBar, useTabBarClearance } from '@/components/ui/TabBar';
import { useTabBarNav } from '@/features/navigation/use-tab-bar-nav';

import { useMarketplaceFeatured } from '../../features/community/hooks/use-marketplace';
import { MarketplaceItemCard } from '../../features/community/components/marketplace-item-card';

const BROWSE_LINKS = [
  {
    href: '/community/flashcard-sets',
    label: 'Flashcard Sets',
    description: 'Study sets created by the community',
    icon: 'layers-outline' as const,
  },
  {
    href: '/community/reviewer-packs',
    label: 'Reviewer Packs',
    description: 'Curated review materials for bar subjects',
    icon: 'book-outline' as const,
  },
  {
    href: '/community/digests',
    label: 'Case Digests',
    description: 'Community-contributed and AI-generated digests',
    icon: 'document-text-outline' as const,
  },
];

export default function CommunityScreen() {
  const {
    data: featuredRes,
    isLoading,
    isFetching,
    refetch,
  } = useMarketplaceFeatured();

  const featured = featuredRes?.data;
  const navigate = useTabBarNav();
  const clearance = useTabBarClearance();

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  return (
    <>
      <Stack.Screen options={{ title: 'Community' }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: clearance }]}
        refreshControl={
          <RefreshControl
            refreshing={isFetching && !isLoading}
            onRefresh={handleRefresh}
            colors={['#1a56db']}
          />
        }
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <Ionicons name="people-outline" size={22} color="#6b7280" />
          <Text style={styles.headerTitle}>Community Marketplace</Text>
        </View>
        <Text style={styles.headerSubtitle}>
          Discover study materials, case digests, and reviewer packs shared by
          the legal community.
        </Text>

        {/* Browse Cards */}
        <View style={styles.browseGrid}>
          {BROWSE_LINKS.map((link) => (
            <TouchableOpacity
              key={link.href}
              style={styles.browseCard}
              onPress={() => router.push(link.href as never)}
              activeOpacity={0.7}
            >
              <View style={styles.browseIconBox}>
                <Ionicons name={link.icon} size={20} color="#1a56db" />
              </View>
              <View style={styles.browseTextBox}>
                <Text style={styles.browseLabel}>{link.label}</Text>
                <Text style={styles.browseDesc} numberOfLines={2}>
                  {link.description}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
            </TouchableOpacity>
          ))}
        </View>

        {/* Expert CTA */}
        <TouchableOpacity
          style={styles.expertCard}
          onPress={() => router.push('/settings' as never)}
          activeOpacity={0.7}
        >
          <View style={styles.expertIcon}>
            <Ionicons name="shield-checkmark" size={20} color="#059669" />
          </View>
          <View style={styles.expertContent}>
            <Text style={styles.expertTitle}>Are you a legal professional?</Text>
            <Text style={styles.expertDesc}>
              Get verified as an expert contributor to boost credibility.
            </Text>
          </View>
          <View style={styles.expertBadge}>
            <Text style={styles.expertBadgeText}>Get Verified</Text>
          </View>
        </TouchableOpacity>

        {/* Featured Section */}
        <Text style={styles.sectionTitle}>Featured</Text>

        {isLoading && (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#1a56db" />
          </View>
        )}

        {!isLoading && featured && (
          <>
            {/* Featured Flashcard Sets */}
            {featured.flashcardSets.length > 0 && (
              <View style={styles.featuredSection}>
                <View style={styles.featuredHeader}>
                  <Text style={styles.featuredLabel}>Flashcard Sets</Text>
                  <TouchableOpacity
                    onPress={() =>
                      router.push('/community/flashcard-sets' as never)
                    }
                  >
                    <Text style={styles.seeAll}>See All</Text>
                  </TouchableOpacity>
                </View>
                {featured.flashcardSets.map((item) => (
                  <MarketplaceItemCard key={item.id} item={item} />
                ))}
              </View>
            )}

            {/* Featured Reviewer Packs */}
            {featured.reviewerPacks.length > 0 && (
              <View style={styles.featuredSection}>
                <View style={styles.featuredHeader}>
                  <Text style={styles.featuredLabel}>Reviewer Packs</Text>
                  <TouchableOpacity
                    onPress={() =>
                      router.push('/community/reviewer-packs' as never)
                    }
                  >
                    <Text style={styles.seeAll}>See All</Text>
                  </TouchableOpacity>
                </View>
                {featured.reviewerPacks.map((item) => (
                  <MarketplaceItemCard key={item.id} item={item} />
                ))}
              </View>
            )}

            {/* Featured Digests */}
            {featured.digests.length > 0 && (
              <View style={styles.featuredSection}>
                <View style={styles.featuredHeader}>
                  <Text style={styles.featuredLabel}>Case Digests</Text>
                  <TouchableOpacity
                    onPress={() =>
                      router.push('/community/digests' as never)
                    }
                  >
                    <Text style={styles.seeAll}>See All</Text>
                  </TouchableOpacity>
                </View>
                {featured.digests.map((item) => (
                  <MarketplaceItemCard key={item.id} item={item} />
                ))}
              </View>
            )}

            {featured.flashcardSets.length === 0 &&
              featured.reviewerPacks.length === 0 &&
              featured.digests.length === 0 && (
                <View style={styles.emptyBox}>
                  <Ionicons name="people-outline" size={40} color="#d1d5db" />
                  <Text style={styles.emptyText}>
                    No featured content yet. Be the first to share!
                  </Text>
                </View>
              )}
          </>
        )}
      </ScrollView>

      {/* app/community/* sits outside the (tabs) group and (tabs)/_layout
          hides the native tab bar, so without this the screen has no
          navigation at all beyond the Stack back button. */}
      <TabBar active="feed" onPress={navigate} />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  content: { padding: 12 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 18,
    marginBottom: 16,
  },
  browseGrid: {
    gap: 8,
    marginBottom: 16,
  },
  browseCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  browseIconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  browseTextBox: { flex: 1 },
  browseLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  browseDesc: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 2,
  },
  expertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    gap: 10,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  expertIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#ecfdf5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  expertContent: { flex: 1 },
  expertTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
  },
  expertDesc: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 2,
  },
  expertBadge: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  expertBadgeText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#374151',
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
  },
  loadingBox: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  featuredSection: {
    marginBottom: 16,
  },
  featuredHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  featuredLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  seeAll: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1a56db',
  },
  emptyBox: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 32,
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    fontSize: 13,
    color: '#9ca3af',
    textAlign: 'center',
  },
});

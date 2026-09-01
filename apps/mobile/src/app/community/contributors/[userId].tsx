import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { TabBar, useTabBarClearance } from '@/components/ui/TabBar';
import { useTabBarNav } from '@/features/navigation/use-tab-bar-nav';

import { useContributorProfile } from '../../../features/community/hooks/use-marketplace';
import { ExpertBadge } from '../../../features/community/components/expert-badge';
import { StarRatingDisplay } from '../../../features/community/components/star-rating';

const STAT_CARDS: Array<{
  key: 'flashcardSetCount' | 'reviewerPackCount' | 'digestCount' | 'totalRatingsReceived';
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = [
  { key: 'flashcardSetCount', label: 'Flashcard Sets', icon: 'layers-outline' },
  { key: 'reviewerPackCount', label: 'Reviewer Packs', icon: 'book-outline' },
  { key: 'digestCount', label: 'Digests', icon: 'document-text-outline' },
  { key: 'totalRatingsReceived', label: 'Ratings', icon: 'star-outline' },
];

export default function ContributorProfileScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const navigate = useTabBarNav();
  const clearance = useTabBarClearance();
  const { data, isLoading, error } = useContributorProfile(userId ?? '');

  // Bare { success, data } envelope — already unwrapped by `apiClient`.
  const profile = data;

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Contributor' }} />
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color="#1a56db" />
        </View>
        <TabBar active="feed" onPress={navigate} />
      </>
    );
  }

  if (error || !profile) {
    return (
      <>
        <Stack.Screen options={{ title: 'Contributor' }} />
        <View style={styles.errorState}>
          <Ionicons name="alert-circle-outline" size={40} color="#dc2626" />
          <Text style={styles.errorText}>
            {error instanceof Error
              ? error.message
              : 'Failed to load contributor profile'}
          </Text>
        </View>
        <TabBar active="feed" onPress={navigate} />
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: profile.user.fullName }} />
      <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: clearance }]}>
        {/* Profile header */}
        <View style={styles.profileHeader}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {profile.user.fullName.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.profileInfo}>
            <View style={styles.nameRow}>
              <Text style={styles.name}>{profile.user.fullName}</Text>
              {profile.expertVerification && (
                <ExpertBadge
                  expertiseType={profile.expertVerification.expertiseType}
                  status={profile.expertVerification.status}
                  size="md"
                />
              )}
            </View>
            <View style={styles.metaRow}>
              <Ionicons name="calendar-outline" size={13} color="#6b7280" />
              <Text style={styles.metaText}>
                Joined{' '}
                {new Date(profile.user.createdAt).toLocaleDateString('en-PH', {
                  month: 'long',
                  year: 'numeric',
                })}
              </Text>
            </View>
            {profile.stats.avgRating != null && (
              <View style={styles.metaRow}>
                <Text style={styles.metaText}>Average rating:</Text>
                <StarRatingDisplay
                  value={profile.stats.avgRating}
                  size="sm"
                />
              </View>
            )}
          </View>
        </View>

        {/* Stat cards */}
        <View style={styles.statsGrid}>
          {STAT_CARDS.map((stat) => {
            const value = profile.stats[stat.key];
            return (
              <View key={stat.key} style={styles.statCard}>
                <View style={styles.statIconRow}>
                  <Ionicons name={stat.icon} size={16} color="#6b7280" />
                  <Text style={styles.statLabel}>{stat.label}</Text>
                </View>
                <Text style={styles.statValue}>{value}</Text>
              </View>
            );
          })}
        </View>
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
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
  },
  errorText: {
    fontSize: 13,
    color: '#dc2626',
    textAlign: 'center',
  },
  profileHeader: {
    flexDirection: 'row',
    gap: 14,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#6b7280',
  },
  profileInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  name: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  metaText: {
    fontSize: 12,
    color: '#6b7280',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statCard: {
    width: '47%',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  statIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  statLabel: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '500',
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
  },
});

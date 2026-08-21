import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import type { MarketplaceItem } from '../types';
import { ExpertBadge } from './expert-badge';
import { StarRatingDisplay } from './star-rating';
import { VoteButtons } from './vote-buttons';

const CONTENT_TYPE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  flashcard_set: 'layers-outline',
  reviewer_pack: 'book-outline',
  digest: 'document-text-outline',
};

const CONTENT_TYPE_LABELS: Record<string, string> = {
  flashcard_set: 'Flashcard Set',
  reviewer_pack: 'Reviewer Pack',
  digest: 'Digest',
};

function getContentRoute(contentType: string, id: string): Href {
  switch (contentType) {
    case 'flashcard_set':
      return `/study/flashcards/${id}`;
    case 'reviewer_pack':
      return `/study/reviewer-packs/${id}`;
    case 'digest':
      return `/digest/${id}`;
    default:
      return `/community`;
  }
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

interface MarketplaceItemCardProps {
  item: MarketplaceItem;
  showContentType?: boolean;
}

export function MarketplaceItemCard({
  item,
  showContentType = false,
}: MarketplaceItemCardProps) {
  const iconName = CONTENT_TYPE_ICONS[item.contentType] ?? 'document-outline';
  const typeLabel = CONTENT_TYPE_LABELS[item.contentType] ?? item.contentType;

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(getContentRoute(item.contentType, item.id))}
      activeOpacity={0.7}
    >
      <View style={styles.row}>
        {/* Icon */}
        <View style={styles.iconBox}>
          <Ionicons name={iconName} size={18} color="#6b7280" />
        </View>

        {/* Content */}
        <View style={styles.content}>
          {/* Title */}
          <Text style={styles.title} numberOfLines={1}>
            {item.title}
          </Text>

          {/* Badges */}
          <View style={styles.badgeRow}>
            {showContentType && (
              <View style={styles.typeBadge}>
                <Text style={styles.typeBadgeText}>{typeLabel}</Text>
              </View>
            )}
            {item.barSubject && (
              <View style={styles.subjectBadge}>
                <Text style={styles.subjectBadgeText}>
                  {item.barSubject.replace(/_/g, ' ')}
                </Text>
              </View>
            )}
            {item.topic && (
              <Text style={styles.topicText} numberOfLines={1}>
                {item.topic}
              </Text>
            )}
          </View>

          {/* Description */}
          {item.description ? (
            <Text style={styles.description} numberOfLines={2}>
              {item.description}
            </Text>
          ) : null}

          {/* Footer: creator + stats */}
          <View style={styles.footer}>
            {/* Creator */}
            <TouchableOpacity
              style={styles.creatorRow}
              onPress={() =>
                router.push(`/community/contributors/${item.creator.id}`)
              }
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            >
              <Ionicons name="person-outline" size={12} color="#6b7280" />
              <Text style={styles.creatorName} numberOfLines={1}>
                {item.creator.fullName}
              </Text>
              {item.creator.expertVerification && (
                <ExpertBadge
                  expertiseType={item.creator.expertVerification.expertiseType}
                  status={item.creator.expertVerification.status}
                  size="sm"
                />
              )}
            </TouchableOpacity>

            {/* Rating */}
            <StarRatingDisplay
              value={item.avgRating}
              count={item.ratingCount}
              size="sm"
            />

            {/* Item count */}
            <Text style={styles.itemCount}>
              {formatCount(item.itemCount)} items
            </Text>

            {/* Vote buttons for digests */}
            {item.contentType === 'digest' && (
              <VoteButtons
                entityType="digest"
                entityId={item.id}
                voteScore={item.voteScore}
              />
            )}
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  typeBadge: {
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  typeBadgeText: {
    fontSize: 10,
    color: '#6b7280',
    fontWeight: '500',
  },
  subjectBadge: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  subjectBadgeText: {
    fontSize: 10,
    color: '#6b7280',
    textTransform: 'capitalize',
  },
  topicText: {
    fontSize: 11,
    color: '#9ca3af',
  },
  description: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 4,
    lineHeight: 16,
  },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  creatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  creatorName: {
    fontSize: 11,
    color: '#6b7280',
    maxWidth: 100,
  },
  itemCount: {
    fontSize: 11,
    color: '#6b7280',
  },
});

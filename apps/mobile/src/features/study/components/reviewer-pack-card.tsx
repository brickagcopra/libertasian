import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ReviewerPack } from '../types';

interface ReviewerPackCardProps {
  item: ReviewerPack;
  onPress: () => void;
  onDelete?: () => void;
}

export function ReviewerPackCard({
  item,
  onPress,
  onDelete,
}: ReviewerPackCardProps) {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.header}>
        <View style={styles.badges}>
          {item.barSubject ? (
            <View style={styles.subjectBadge}>
              <Text style={styles.subjectBadgeText}>
                {item.barSubject.replace(/_/g, ' ')}
              </Text>
            </View>
          ) : null}
          <View style={styles.countBadge}>
            <Ionicons name="folder-outline" size={12} color="#6b7280" />
            <Text style={styles.countText}>
              {item.itemCount} item{item.itemCount !== 1 ? 's' : ''}
            </Text>
          </View>
        </View>
        {onDelete ? (
          <TouchableOpacity
            onPress={onDelete}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="trash-outline" size={18} color="#ef4444" />
          </TouchableOpacity>
        ) : null}
      </View>

      <Text style={styles.title} numberOfLines={2}>
        {item.title}
      </Text>

      {item.description ? (
        <Text style={styles.description} numberOfLines={2}>
          {item.description}
        </Text>
      ) : null}

      <View style={styles.footer}>
        {item.creator ? (
          <Text style={styles.creator}>by {item.creator.fullName}</Text>
        ) : null}
        <Text style={styles.date}>
          {new Date(item.createdAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </Text>
      </View>
    </TouchableOpacity>
  );
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
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  badges: { flexDirection: 'row', gap: 6, flex: 1 },
  subjectBadge: {
    backgroundColor: '#eff6ff',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  subjectBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1d4ed8',
    textTransform: 'capitalize',
  },
  countBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#f3f4f6',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  countText: { fontSize: 11, color: '#6b7280', fontWeight: '500' },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    lineHeight: 21,
    marginBottom: 4,
  },
  description: {
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 19,
    marginBottom: 4,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  creator: { fontSize: 11, color: '#9ca3af' },
  date: { fontSize: 11, color: '#9ca3af' },
});

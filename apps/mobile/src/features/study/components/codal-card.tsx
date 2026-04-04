import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { OfflineBadge } from './offline-badge';
import type { CodalListItem } from '../types';

interface CodalCardProps {
  item: CodalListItem;
  isOffline: boolean;
  isSaving: boolean;
  onToggleOffline: () => void;
}

export function CodalCard({
  item,
  isOffline,
  isSaving,
  onToggleOffline,
}: CodalCardProps) {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/reader/${item.id}`)}
      activeOpacity={0.7}
    >
      <View style={styles.header}>
        <View style={styles.badges}>
          <View style={styles.typeBadge}>
            <Text style={styles.typeBadgeText}>
              {item.documentType.replace(/_/g, ' ')}
            </Text>
          </View>
          {item.isOfficial ? (
            <View style={styles.officialBadge}>
              <Text style={styles.officialBadgeText}>Official</Text>
            </View>
          ) : null}
          {isOffline ? <OfflineBadge size="small" /> : null}
        </View>
        <TouchableOpacity
          onPress={onToggleOffline}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          disabled={isSaving}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color="#1a56db" />
          ) : (
            <Ionicons
              name={isOffline ? 'cloud-done' : 'cloud-download-outline'}
              size={20}
              color={isOffline ? '#059669' : '#9ca3af'}
            />
          )}
        </TouchableOpacity>
      </View>

      <Text style={styles.title} numberOfLines={2}>
        {item.shortTitle ?? item.title}
      </Text>

      {item.citationText ? (
        <Text style={styles.citation} numberOfLines={1}>
          {item.citationText}
        </Text>
      ) : null}

      <View style={styles.footer}>
        <Text style={styles.sections}>
          {item.sectionCount} section{item.sectionCount !== 1 ? 's' : ''}
        </Text>
        {item.promulgationDate ? (
          <Text style={styles.date}>
            {new Date(item.promulgationDate).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </Text>
        ) : null}
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
  typeBadge: {
    backgroundColor: '#eff6ff',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1d4ed8',
    textTransform: 'capitalize',
  },
  officialBadge: {
    backgroundColor: '#ecfdf5',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  officialBadgeText: { fontSize: 11, fontWeight: '600', color: '#059669' },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    lineHeight: 21,
    marginBottom: 4,
  },
  citation: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 8,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  sections: { fontSize: 11, color: '#9ca3af' },
  date: { fontSize: 11, color: '#9ca3af' },
});

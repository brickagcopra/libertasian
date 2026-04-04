import { useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  useTimeline,
  useDeleteTimeline,
} from '../../../features/timelines/hooks/use-timelines';
import {
  TIMELINE_STATUS_LABELS,
  EVENT_TYPE_LABELS,
} from '../../../features/timelines/types';
import type { TimelineEvent } from '../../../features/timelines/types';

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending: { bg: '#fef3c7', text: '#92400e' },
  generating: { bg: '#dbeafe', text: '#1e40af' },
  completed: { bg: '#d1fae5', text: '#065f46' },
  failed: { bg: '#fecaca', text: '#991b1b' },
};

const EVENT_TYPE_COLORS: Record<string, string> = {
  filing: '#8b5cf6',
  decision: '#059669',
  legislation: '#1a56db',
  amendment: '#ea580c',
  enforcement: '#dc2626',
  other: '#6b7280',
};

export default function TimelineDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: resp, isLoading, error } = useTimeline(id ?? '', !!id);
  const deleteTimeline = useDeleteTimeline();

  const timeline = resp?.data;

  const handleDelete = useCallback(() => {
    if (!id) return;
    Alert.alert(
      'Delete Timeline',
      'Are you sure? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            deleteTimeline.mutate(id, { onSuccess: () => router.back() }),
        },
      ],
    );
  }, [id, deleteTimeline]);

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Timeline' }} />
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color="#1a56db" />
        </View>
      </>
    );
  }

  if (error || !timeline) {
    return (
      <>
        <Stack.Screen options={{ title: 'Timeline' }} />
        <View style={styles.errorState}>
          <Ionicons name="alert-circle-outline" size={48} color="#dc2626" />
          <Text style={styles.errorTitle}>Failed to load timeline</Text>
          <Text style={styles.errorText}>
            {error instanceof Error ? error.message : 'Timeline not found'}
          </Text>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  const statusColor = STATUS_COLORS[timeline.status] ?? {
    bg: '#f3f4f6',
    text: '#6b7280',
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: timeline.title,
          headerRight: () => (
            <TouchableOpacity
              onPress={handleDelete}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="trash-outline" size={22} color="#dc2626" />
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Status + Meta */}
        <View style={styles.metaRow}>
          <View style={[styles.badge, { backgroundColor: statusColor.bg }]}>
            <Text style={[styles.badgeText, { color: statusColor.text }]}>
              {TIMELINE_STATUS_LABELS[timeline.status] ?? timeline.status}
            </Text>
          </View>
          <View style={[styles.badge, { backgroundColor: '#e0e7ff' }]}>
            <Text style={[styles.badgeText, { color: '#3730a3' }]}>
              {timeline.documentIds.length} docs
            </Text>
          </View>
        </View>

        <Text style={styles.dateText}>
          {new Date(timeline.createdAt).toLocaleDateString('en-PH', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </Text>
        {timeline.matter && (
          <TouchableOpacity
            style={styles.matterLink}
            onPress={() =>
              router.push(`/workspace/matters/${timeline.matter!.id}`)
            }
          >
            <Ionicons name="folder-outline" size={14} color="#1a56db" />
            <Text style={styles.matterLinkText}>{timeline.matter.title}</Text>
          </TouchableOpacity>
        )}

        {/* Generating state */}
        {(timeline.status === 'pending' ||
          timeline.status === 'generating') && (
          <View style={styles.generatingCard}>
            <ActivityIndicator size="small" color="#1a56db" />
            <View style={styles.generatingTextContainer}>
              <Text style={styles.generatingTitle}>
                {timeline.status === 'pending'
                  ? 'Timeline queued...'
                  : 'Generating timeline...'}
              </Text>
              <Text style={styles.generatingSubtext}>
                This may take up to 60 seconds. The page will update
                automatically.
              </Text>
            </View>
          </View>
        )}

        {/* Failed state */}
        {timeline.status === 'failed' && (
          <View style={styles.failedCard}>
            <Ionicons name="warning-outline" size={20} color="#991b1b" />
            <Text style={styles.failedText}>
              Timeline generation failed. Try again with different documents.
            </Text>
          </View>
        )}

        {/* Completed — Results */}
        {timeline.status === 'completed' && timeline.timelineJson && (
          <>
            {/* Summary */}
            {timeline.timelineJson.summary && (
              <View style={[styles.section, styles.summarySection]}>
                <Text style={styles.sectionLabel}>Summary</Text>
                <Text style={styles.sectionContent}>
                  {timeline.timelineJson.summary}
                </Text>
              </View>
            )}

            {/* Timeline Events */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>
                Timeline ({timeline.timelineJson.events.length} events)
              </Text>
              {timeline.timelineJson.events.map((event, index) => (
                <TimelineEventCard
                  key={index}
                  event={event}
                  isLast={
                    index === timeline.timelineJson!.events.length - 1
                  }
                />
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </>
  );
}

function TimelineEventCard({
  event,
  isLast,
}: {
  event: TimelineEvent;
  isLast: boolean;
}) {
  const dotColor = EVENT_TYPE_COLORS[event.eventType] ?? '#6b7280';

  return (
    <View style={styles.eventRow}>
      {/* Timeline connector */}
      <View style={styles.eventConnector}>
        <View style={[styles.eventDot, { backgroundColor: dotColor }]} />
        {!isLast && <View style={styles.eventLine} />}
      </View>

      {/* Content */}
      <View style={styles.eventContent}>
        <View style={styles.eventHeader}>
          <Text style={styles.eventDate}>{event.date}</Text>
          <View
            style={[
              styles.eventTypeBadge,
              { backgroundColor: `${dotColor}15` },
            ]}
          >
            <Text style={[styles.eventTypeText, { color: dotColor }]}>
              {EVENT_TYPE_LABELS[event.eventType] ?? event.eventType}
            </Text>
          </View>
        </View>
        <Text style={styles.eventLabel}>{event.label}</Text>
        <Text style={styles.eventDescription}>{event.description}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  content: { padding: 16, gap: 12 },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
    marginTop: 12,
  },
  errorText: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 6,
    textAlign: 'center',
  },
  backButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
  },
  backButtonText: { fontSize: 14, fontWeight: '500', color: '#374151' },

  metaRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  badgeText: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },

  dateText: { fontSize: 12, color: '#9ca3af' },
  matterLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  matterLinkText: { fontSize: 13, color: '#1a56db', fontWeight: '500' },

  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
  },
  summarySection: {
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#9ca3af',
    marginBottom: 8,
  },
  sectionContent: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 21,
  },

  generatingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#eff6ff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  generatingTextContainer: { flex: 1 },
  generatingTitle: { fontSize: 14, fontWeight: '600', color: '#1e40af' },
  generatingSubtext: { fontSize: 12, color: '#3b82f6', marginTop: 2 },

  failedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fef2f2',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  failedText: { fontSize: 13, color: '#991b1b', flex: 1 },

  // Timeline event styles
  eventRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  eventConnector: {
    width: 24,
    alignItems: 'center',
  },
  eventDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4,
  },
  eventLine: {
    width: 2,
    flex: 1,
    backgroundColor: '#e5e7eb',
    marginTop: 2,
  },
  eventContent: {
    flex: 1,
    paddingBottom: 16,
    paddingLeft: 8,
  },
  eventHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  eventDate: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6b7280',
  },
  eventTypeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  eventTypeText: {
    fontSize: 9,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  eventLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 2,
  },
  eventDescription: {
    fontSize: 13,
    color: '#374151',
    lineHeight: 19,
  },
});

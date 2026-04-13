import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSyllabus, useSyllabusTopic } from '../../../../../features/study/hooks/use-syllabus';
import type { SyllabusResourceType, SyllabusTopicResource } from '../../../../../features/study/types';

const RESOURCE_TYPE_CONFIG: Record<
  SyllabusResourceType,
  { icon: keyof typeof Ionicons.glyphMap; label: string; color: string; bg: string }
> = {
  legal_document: { icon: 'document-text-outline', label: 'Document', color: '#1d4ed8', bg: '#eff6ff' },
  digest: { icon: 'newspaper-outline', label: 'Digest', color: '#059669', bg: '#ecfdf5' },
  flashcard_set: { icon: 'layers-outline', label: 'Flashcards', color: '#7c3aed', bg: '#ede9fe' },
  reviewer_pack: { icon: 'folder-outline', label: 'Reviewer', color: '#ea580c', bg: '#fff7ed' },
  codal_section: { icon: 'book-outline', label: 'Codal', color: '#0891b2', bg: '#ecfeff' },
};

function navigateToResource(resource: SyllabusTopicResource) {
  switch (resource.resourceType) {
    case 'legal_document':
      router.push(`/reader/${resource.resourceId}`);
      break;
    case 'digest':
      router.push(`/digest/${resource.resourceId}`);
      break;
    case 'flashcard_set':
      router.push(`/study/flashcards/${resource.resourceId}`);
      break;
    case 'reviewer_pack':
      router.push(`/study/reviewer-packs/${resource.resourceId}`);
      break;
    default:
      break;
  }
}

function ResourceCard({ resource }: { resource: SyllabusTopicResource }) {
  const config = RESOURCE_TYPE_CONFIG[resource.resourceType] ?? {
    icon: 'link-outline' as keyof typeof Ionicons.glyphMap,
    label: resource.resourceType.replace(/_/g, ' '),
    color: '#6b7280',
    bg: '#f3f4f6',
  };

  return (
    <TouchableOpacity
      style={styles.resourceCard}
      onPress={() => navigateToResource(resource)}
      activeOpacity={0.7}
    >
      <View style={[styles.resourceIcon, { backgroundColor: config.bg }]}>
        <Ionicons name={config.icon} size={20} color={config.color} />
      </View>
      <View style={styles.resourceContent}>
        <Text style={styles.resourceTitle} numberOfLines={2}>
          {resource.title ?? 'Untitled Resource'}
        </Text>
        {resource.note ? (
          <Text style={styles.resourceNote} numberOfLines={1}>
            {resource.note}
          </Text>
        ) : null}
      </View>
      <View style={[styles.typeBadge, { backgroundColor: config.bg }]}>
        <Text style={[styles.typeBadgeText, { color: config.color }]}>
          {config.label}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default function TopicDetailScreen() {
  const { subject, topicId } = useLocalSearchParams<{
    subject: string;
    topicId: string;
  }>();
  const subjectCode = subject ?? '';
  const topicIdStr = topicId ?? '';

  const { data: syllabus, isLoading: syllabusLoading } = useSyllabus(subjectCode);
  const syllabusId = syllabus?.id ?? '';
  const {
    data: topic,
    isLoading: topicLoading,
  } = useSyllabusTopic(syllabusId, topicIdStr);

  const isLoading = syllabusLoading || topicLoading;

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Loading...' }} />
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color="#1a56db" />
        </View>
      </>
    );
  }

  if (!topic) {
    return (
      <>
        <Stack.Screen options={{ title: 'Not Found' }} />
        <View style={styles.errorState}>
          <Ionicons name="alert-circle-outline" size={48} color="#ef4444" />
          <Text style={styles.errorTitle}>Topic not found</Text>
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

  const resources = topic.resources ?? [];

  return (
    <>
      <Stack.Screen
        options={{
          title: topic.title,
          headerBackTitle: 'Back',
        }}
      />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.topicTitle}>{topic.title}</Text>
          {topic.description ? (
            <Text style={styles.topicDescription}>{topic.description}</Text>
          ) : null}
          {topic.parent ? (
            <View style={styles.breadcrumb}>
              <Ionicons name="arrow-up-outline" size={14} color="#6b7280" />
              <Text style={styles.breadcrumbText}>{topic.parent.title}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.resourcesSection}>
          <Text style={styles.sectionTitle}>
            Linked Resources ({resources.length})
          </Text>
          {resources.length === 0 ? (
            <View style={styles.emptyResources}>
              <Ionicons name="link-outline" size={32} color="#d1d5db" />
              <Text style={styles.emptyText}>No resources linked to this topic</Text>
            </View>
          ) : (
            resources.map((resource) => (
              <ResourceCard key={resource.id} resource={resource} />
            ))
          )}
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  content: { paddingBottom: 32 },
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
    backgroundColor: '#fff',
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
    marginTop: 12,
  },
  backButton: {
    marginTop: 16,
    backgroundColor: '#1a56db',
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  backButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  header: {
    backgroundColor: '#fff',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  topicTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    lineHeight: 26,
  },
  topicDescription: {
    fontSize: 14,
    color: '#6b7280',
    lineHeight: 21,
    marginTop: 8,
  },
  breadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 10,
  },
  breadcrumbText: {
    fontSize: 12,
    color: '#6b7280',
  },
  resourcesSection: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
  },
  resourceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  resourceIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resourceContent: { flex: 1 },
  resourceTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  resourceNote: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
  typeBadge: {
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  emptyResources: {
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

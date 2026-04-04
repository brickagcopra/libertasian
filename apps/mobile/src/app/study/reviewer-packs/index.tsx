import { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
} from 'react-native';
import { router, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  useReviewerPacks,
  useCreateReviewerPack,
  useDeleteReviewerPack,
} from '../../../features/study/hooks/use-reviewer-packs';
import { useBarSubjects } from '../../../features/study/hooks/use-bar-subjects';
import { ReviewerPackCard } from '../../../features/study/components/reviewer-pack-card';
import type { ReviewerPack } from '../../../features/study/types';

export default function ReviewerPacksScreen() {
  const [subjectFilter, setSubjectFilter] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newSubject, setNewSubject] = useState('');

  const { data, isLoading, isFetching, refetch } = useReviewerPacks({
    barSubject: subjectFilter || undefined,
  });
  const { data: subjects } = useBarSubjects();
  const createPack = useCreateReviewerPack();
  const deletePack = useDeleteReviewerPack();

  const packs = data?.data ?? [];

  const handleCreate = useCallback(async () => {
    if (!newTitle.trim()) return;
    try {
      const result = await createPack.mutateAsync({
        title: newTitle.trim(),
        description: newDescription.trim() || undefined,
        barSubject: newSubject || undefined,
      });
      setShowCreateModal(false);
      setNewTitle('');
      setNewDescription('');
      setNewSubject('');
      router.push(`/study/reviewer-packs/${result.id}`);
    } catch {
      Alert.alert('Error', 'Failed to create reviewer pack.');
    }
  }, [newTitle, newDescription, newSubject, createPack]);

  const handleDelete = useCallback(
    (id: string, title: string) => {
      Alert.alert('Delete Pack', `Delete "${title}"? This cannot be undone.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deletePack.mutate(id),
        },
      ]);
    },
    [deletePack],
  );

  const renderItem = useCallback(
    ({ item }: { item: ReviewerPack }) => (
      <ReviewerPackCard
        item={item}
        onPress={() => router.push(`/study/reviewer-packs/${item.id}`)}
        onDelete={() => handleDelete(item.id, item.title)}
      />
    ),
    [handleDelete],
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Reviewer Packs',
          headerBackTitle: 'Study',
          headerRight: () => (
            <TouchableOpacity
              onPress={() => setShowCreateModal(true)}
              style={{ marginRight: 16 }}
            >
              <Ionicons name="add-circle-outline" size={24} color="#1a56db" />
            </TouchableOpacity>
          ),
        }}
      />
      <View style={styles.container}>
        {/* Subject Filter */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterScroll}
          contentContainerStyle={styles.filterContent}
        >
          <TouchableOpacity
            style={[
              styles.filterChip,
              subjectFilter === '' && styles.filterChipActive,
            ]}
            onPress={() => setSubjectFilter('')}
          >
            <Text
              style={[
                styles.filterChipText,
                subjectFilter === '' && styles.filterChipTextActive,
              ]}
            >
              All
            </Text>
          </TouchableOpacity>
          {(subjects ?? []).map((s) => (
            <TouchableOpacity
              key={s.code}
              style={[
                styles.filterChip,
                subjectFilter === s.code && styles.filterChipActive,
              ]}
              onPress={() =>
                setSubjectFilter(subjectFilter === s.code ? '' : s.code)
              }
            >
              <Text
                style={[
                  styles.filterChipText,
                  subjectFilter === s.code && styles.filterChipTextActive,
                ]}
              >
                {s.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color="#1a56db" />
          </View>
        ) : packs.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="folder-outline" size={48} color="#d1d5db" />
            <Text style={styles.emptyTitle}>No reviewer packs</Text>
            <Text style={styles.emptyText}>
              Create your first reviewer pack to organize study materials
            </Text>
            <TouchableOpacity
              style={styles.createButton}
              onPress={() => setShowCreateModal(true)}
            >
              <Text style={styles.createButtonText}>Create Pack</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={packs}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            refreshing={isFetching && !isLoading}
            onRefresh={() => refetch()}
          />
        )}

        {/* Create Modal */}
        <Modal
          visible={showCreateModal}
          animationType="slide"
          transparent
          onRequestClose={() => setShowCreateModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>New Reviewer Pack</Text>
                <TouchableOpacity onPress={() => setShowCreateModal(false)}>
                  <Ionicons name="close" size={24} color="#374151" />
                </TouchableOpacity>
              </View>

              <TextInput
                style={styles.input}
                value={newTitle}
                onChangeText={setNewTitle}
                placeholder="Title *"
                placeholderTextColor="#9ca3af"
              />
              <TextInput
                style={[styles.input, styles.textArea]}
                value={newDescription}
                onChangeText={setNewDescription}
                placeholder="Description (optional)"
                placeholderTextColor="#9ca3af"
                multiline
              />

              <Text style={styles.inputLabel}>Bar Subject (optional)</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.subjectScroll}
              >
                {(subjects ?? []).map((s) => (
                  <TouchableOpacity
                    key={s.code}
                    style={[
                      styles.filterChip,
                      newSubject === s.code && styles.filterChipActive,
                    ]}
                    onPress={() =>
                      setNewSubject(newSubject === s.code ? '' : s.code)
                    }
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        newSubject === s.code && styles.filterChipTextActive,
                      ]}
                    >
                      {s.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <TouchableOpacity
                style={[
                  styles.saveButton,
                  !newTitle.trim() && styles.saveButtonDisabled,
                ]}
                onPress={handleCreate}
                disabled={!newTitle.trim() || createPack.isPending}
              >
                {createPack.isPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.saveButtonText}>Create</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  filterScroll: { maxHeight: 50 },
  filterContent: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  filterChip: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  filterChipActive: {
    backgroundColor: '#1a56db',
    borderColor: '#1a56db',
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#6b7280',
  },
  filterChipTextActive: { color: '#fff' },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: { padding: 12, gap: 10 },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
    marginTop: 12,
  },
  emptyText: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 20,
  },
  createButton: {
    backgroundColor: '#1a56db',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginTop: 16,
  },
  createButtonText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#111827' },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#111827',
    backgroundColor: '#f9fafb',
    marginBottom: 12,
  },
  textArea: { minHeight: 60, textAlignVertical: 'top' },
  inputLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#374151',
    marginBottom: 6,
  },
  subjectScroll: { marginBottom: 16, maxHeight: 40 },
  saveButton: {
    backgroundColor: '#1a56db',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveButtonDisabled: { opacity: 0.5 },
  saveButtonText: { fontSize: 15, fontWeight: '600', color: '#fff' },
});

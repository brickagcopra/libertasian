import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';

import {
  useMyRating,
  useUpsertRating,
  useDeleteRating,
} from '../hooks/use-community-ratings';
import type { CommunityEntityType } from '../types';
import { StarRatingInput } from './star-rating';

interface RatingFormProps {
  entityType: CommunityEntityType;
  entityId: string;
}

export function RatingForm({ entityType, entityId }: RatingFormProps) {
  const { data: myRatingRes } = useMyRating(entityType, entityId);
  const upsertRating = useUpsertRating();
  const deleteRating = useDeleteRating();

  const existing = myRatingRes?.data ?? null;

  const [score, setScore] = useState(0);
  const [reviewTitle, setReviewTitle] = useState('');
  const [reviewBody, setReviewBody] = useState('');
  const [isEditing, setIsEditing] = useState(true);
  const [lastSyncId, setLastSyncId] = useState<string | null>(null);

  // Sync from server when existing rating loads
  useEffect(() => {
    if (existing && existing.id !== lastSyncId) {
      setScore(existing.score);
      setReviewTitle(existing.reviewTitle ?? '');
      setReviewBody(existing.reviewBody ?? '');
      setIsEditing(false);
      setLastSyncId(existing.id);
    }
  }, [existing, lastSyncId]);

  const handleSubmit = useCallback(() => {
    if (score === 0) return;
    upsertRating.mutate(
      {
        entityType,
        entityId,
        score,
        reviewTitle: reviewTitle.trim() || undefined,
        reviewBody: reviewBody.trim() || undefined,
      },
      {
        onSuccess: () => setIsEditing(false),
        onError: (error) => {
          Alert.alert(
            'Error',
            error instanceof Error ? error.message : 'Failed to save rating',
          );
        },
      },
    );
  }, [entityType, entityId, score, reviewTitle, reviewBody, upsertRating]);

  const handleDelete = useCallback(() => {
    if (!existing) return;
    Alert.alert('Delete Rating', 'Are you sure you want to delete your rating?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteRating.mutate(
            { ratingId: existing.id, entityType, entityId },
            {
              onSuccess: () => {
                setScore(0);
                setReviewTitle('');
                setReviewBody('');
                setIsEditing(true);
                setLastSyncId(null);
              },
            },
          );
        },
      },
    ]);
  }, [existing, entityType, entityId, deleteRating]);

  // Compact view when not editing
  if (!isEditing && existing) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Your rating</Text>
        <View style={styles.scoreRow}>
          <StarRatingInput value={existing.score} onChange={() => {}} size="sm" />
          <Text style={styles.scoreLabel}>{existing.score}/5</Text>
        </View>
        {existing.reviewTitle ? (
          <Text style={styles.reviewTitle}>{existing.reviewTitle}</Text>
        ) : null}
        {existing.reviewBody ? (
          <Text style={styles.reviewBody}>{existing.reviewBody}</Text>
        ) : null}
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={styles.editButton}
            onPress={() => setIsEditing(true)}
            activeOpacity={0.7}
          >
            <Text style={styles.editButtonText}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={handleDelete}
            disabled={deleteRating.isPending}
            activeOpacity={0.7}
          >
            <Text style={styles.deleteButtonText}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>
        {existing ? 'Edit your rating' : 'Rate this content'}
      </Text>

      {/* Score */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Score</Text>
        <StarRatingInput value={score} onChange={setScore} size="md" />
      </View>

      {/* Title */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Title (optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="Brief summary..."
          placeholderTextColor="#9ca3af"
          value={reviewTitle}
          onChangeText={setReviewTitle}
          maxLength={255}
        />
      </View>

      {/* Body */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Review (optional)</Text>
        <TextInput
          style={[styles.input, styles.textarea]}
          placeholder="Share your thoughts..."
          placeholderTextColor="#9ca3af"
          value={reviewBody}
          onChangeText={setReviewBody}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
        />
      </View>

      {/* Actions */}
      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[
            styles.submitButton,
            (score === 0 || upsertRating.isPending) && styles.submitButtonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={score === 0 || upsertRating.isPending}
          activeOpacity={0.7}
        >
          <Text style={styles.submitButtonText}>
            {upsertRating.isPending
              ? 'Saving...'
              : existing
                ? 'Update Rating'
                : 'Submit Rating'}
          </Text>
        </TouchableOpacity>
        {existing && (
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={() => setIsEditing(false)}
            activeOpacity={0.7}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 14,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 10,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  scoreLabel: {
    fontSize: 13,
    color: '#6b7280',
  },
  reviewTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
    marginTop: 6,
  },
  reviewBody: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 2,
    lineHeight: 18,
  },
  field: {
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: '#374151',
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    color: '#111827',
  },
  textarea: {
    minHeight: 72,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  submitButton: {
    backgroundColor: '#1a56db',
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  editButton: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  editButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#374151',
  },
  deleteButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  deleteButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#dc2626',
  },
  cancelButton: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  cancelButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#6b7280',
  },
});

import { useCallback } from 'react';
import { View, Text, Switch, Alert, StyleSheet } from 'react-native';
import type { PrivacyLevel } from '../types';
import { useUpdatePrivacy } from '../hooks/use-update-privacy';

interface PrivacyToggleProps {
  uploadId: string;
  privacyLevel: PrivacyLevel;
  /** Whether the user has an editorial role that allows promoting to editorial_candidate */
  canPromoteToEditorial?: boolean;
}

export function PrivacyToggle({
  uploadId,
  privacyLevel,
  canPromoteToEditorial = false,
}: PrivacyToggleProps) {
  const mutation = useUpdatePrivacy();
  const isEditorial = privacyLevel === 'editorial_candidate';

  const handleToggle = useCallback(
    (value: boolean) => {
      if (value) {
        Alert.alert(
          'Change to Editorial Candidate?',
          "By changing to 'editorial candidate', this scan may be reviewed by LIBERTASIAN " +
            'editors for inclusion in the public legal corpus. Your personal information will not be shared.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Confirm',
              onPress: () =>
                mutation.mutate({
                  uploadId,
                  privacyLevel: 'editorial_candidate',
                }),
            },
          ],
        );
      } else {
        mutation.mutate({ uploadId, privacyLevel: 'private' });
      }
    },
    [uploadId, mutation],
  );

  // Only editorial-capable roles (owner, admin, editor, reviewer) can see the toggle
  if (!canPromoteToEditorial && !isEditorial) {
    return (
      <View style={styles.container}>
        <View style={styles.row}>
          <Text style={styles.label}>Privacy</Text>
          <Text style={styles.value}>Private</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Text style={styles.label}>Privacy</Text>
        <View style={styles.toggleRow}>
          <Text style={styles.value}>
            {isEditorial ? 'Editorial Candidate' : 'Private'}
          </Text>
          <Switch
            value={isEditorial}
            onValueChange={handleToggle}
            disabled={mutation.isPending || (!canPromoteToEditorial && !isEditorial)}
            trackColor={{ false: '#d1d5db', true: '#93c5fd' }}
            thumbColor={isEditorial ? '#1a56db' : '#f3f4f6'}
          />
        </View>
      </View>
      {!canPromoteToEditorial && (
        <Text style={styles.hint}>
          Editorial candidate option requires an editor or admin role
        </Text>
      )}
      {mutation.isError && (
        <Text style={styles.error}>Failed to update privacy level</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 13,
    color: '#6b7280',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  value: {
    fontSize: 13,
    fontWeight: '500',
    color: '#111827',
  },
  hint: {
    fontSize: 11,
    color: '#9ca3af',
    marginTop: 4,
  },
  error: {
    fontSize: 11,
    color: '#ef4444',
    marginTop: 4,
  },
});

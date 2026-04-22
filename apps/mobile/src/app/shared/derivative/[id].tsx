import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useDerivative } from '../../../features/derivatives/hooks/use-derivatives';
import {
  subjectFromCode,
  typeFromEnum,
} from '../../../features/derivatives/taxonomy';

export default function DerivativeByIdShim() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading, error } = useDerivative(id ?? '', !!id);

  useEffect(() => {
    if (!data) return;
    const typeMeta = typeFromEnum(data.derivativeType);
    const primarySubject =
      data.subjects.find((s) => s.isPrimary) ?? data.subjects[0];
    const subjectMeta = primarySubject
      ? subjectFromCode(primarySubject.code)
      : undefined;

    if (typeMeta && subjectMeta) {
      router.replace(`/library/${typeMeta.slug}/${subjectMeta.slug}/${data.id}`);
    }
  }, [data]);

  if (error) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={48} color="#9ca3af" />
        <Text style={styles.errorText}>
          {error instanceof Error ? error.message : 'Content not found.'}
        </Text>
        <Pressable
          style={styles.backButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.backButtonText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color="#1a56db" />
      {isLoading ? null : (
        <Text style={styles.hintText}>Redirecting…</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { fontSize: 14, color: '#6b7280', marginTop: 8, textAlign: 'center' },
  hintText: { fontSize: 13, color: '#9ca3af', marginTop: 12 },
  backButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#1a56db',
    borderRadius: 8,
  },
  backButtonText: { color: '#fff', fontWeight: '600' },
});

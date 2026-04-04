import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { router, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useBarSubjects } from '../../../features/study/hooks/use-bar-subjects';
import type { BarSubject } from '../../../features/study/types';

const SUBJECT_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  civil_law: 'people-outline',
  commercial_law: 'briefcase-outline',
  criminal_law: 'shield-outline',
  labor_law: 'hammer-outline',
  political_law: 'flag-outline',
  public_international_law: 'globe-outline',
  remedial_law: 'document-text-outline',
  taxation_law: 'calculator-outline',
  legal_ethics: 'scale-outline',
};

function SubjectCard({ item }: { item: BarSubject }) {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/study/codals/${item.code}`)}
      activeOpacity={0.7}
    >
      <View style={styles.cardRow}>
        <View style={styles.iconBox}>
          <Ionicons
            name={SUBJECT_ICONS[item.code] ?? 'book-outline'}
            size={22}
            color="#1a56db"
          />
        </View>
        <View style={styles.cardContent}>
          <Text style={styles.cardTitle}>{item.name}</Text>
          <Text style={styles.cardCount}>
            {item.documentCount} document
            {item.documentCount !== 1 ? 's' : ''}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
      </View>
    </TouchableOpacity>
  );
}

export default function CodalsSubjectSelector() {
  const { data: subjects, isLoading } = useBarSubjects();

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Codal Reader',
          headerBackTitle: 'Study',
        }}
      />
      <View style={styles.container}>
        {isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color="#1a56db" />
          </View>
        ) : (subjects ?? []).length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="book-outline" size={48} color="#d1d5db" />
            <Text style={styles.emptyTitle}>No bar subjects</Text>
            <Text style={styles.emptyText}>
              Bar subjects will appear here when they are configured
            </Text>
          </View>
        ) : (
          <FlatList
            data={subjects ?? []}
            renderItem={({ item }) => <SubjectCard item={item} />}
            keyExtractor={(item) => item.code}
            contentContainerStyle={styles.listContent}
          />
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: { padding: 12, gap: 8 },
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
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardContent: { flex: 1 },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  cardCount: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
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
});

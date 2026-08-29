import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { BarSubject } from '../types';

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

interface SubjectGridProps {
  subjects: BarSubject[];
  onSubjectPress?: (code: string) => void;
}

export function SubjectGrid({ subjects, onSubjectPress }: SubjectGridProps) {
  const handlePress = (code: string) => {
    if (onSubjectPress) {
      onSubjectPress(code);
    } else {
      router.push(`/codals/${code}`);
    }
  };

  return (
    <View style={styles.grid}>
      {subjects.map((subject) => (
        <TouchableOpacity
          key={subject.code}
          style={styles.card}
          onPress={() => handlePress(subject.code)}
          activeOpacity={0.7}
        >
          <Ionicons
            name={SUBJECT_ICONS[subject.code] ?? 'book-outline'}
            size={24}
            color="#1a56db"
          />
          <Text style={styles.name} numberOfLines={2}>
            {subject.name}
          </Text>
          <Text style={styles.count}>
            {subject.documentCount} doc{subject.documentCount !== 1 ? 's' : ''}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  card: {
    width: '31%',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  name: {
    fontSize: 11,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 15,
  },
  count: {
    fontSize: 10,
    color: '#9ca3af',
    marginTop: 3,
  },
});

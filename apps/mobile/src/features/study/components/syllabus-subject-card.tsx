import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ReadinessRing } from './readiness-ring';

const SUBJECT_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  political_law: 'flag-outline',
  labor_law: 'hammer-outline',
  civil_law: 'people-outline',
  taxation_law: 'calculator-outline',
  commercial_law: 'briefcase-outline',
  criminal_law: 'shield-outline',
  remedial_law: 'document-text-outline',
  legal_ethics: 'scale-outline',
  public_international_law: 'globe-outline',
};

interface SyllabusSubjectCardProps {
  barSubjectCode: string;
  title: string;
  topicCount: number;
  completedPct: number;
  onPress?: () => void;
}

export function SyllabusSubjectCard({
  barSubjectCode,
  title,
  topicCount,
  completedPct,
  onPress,
}: SyllabusSubjectCardProps) {
  const handlePress = () => {
    if (onPress) {
      onPress();
    } else {
      router.push(`/study/syllabus/${barSubjectCode}`);
    }
  };

  return (
    <TouchableOpacity style={styles.card} onPress={handlePress} activeOpacity={0.7}>
      <View style={styles.header}>
        <Ionicons
          name={SUBJECT_ICONS[barSubjectCode] ?? 'book-outline'}
          size={20}
          color="#4f46e5"
        />
        <ReadinessRing pct={completedPct} size={40} strokeWidth={4} />
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {title}
      </Text>
      <Text style={styles.count}>
        {topicCount} topic{topicCount !== 1 ? 's' : ''}
      </Text>
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
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
    lineHeight: 18,
  },
  count: {
    fontSize: 11,
    color: '#9ca3af',
    marginTop: 4,
  },
});

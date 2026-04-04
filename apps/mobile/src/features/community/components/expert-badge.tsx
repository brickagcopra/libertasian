import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { ExpertiseType, ExpertVerificationStatus } from '../types';

const EXPERTISE_LABELS: Record<ExpertiseType, string> = {
  lawyer: 'Lawyer',
  law_professor: 'Law Professor',
  judge_retired: 'Retired Judge',
  legal_researcher: 'Legal Researcher',
};

interface ExpertBadgeProps {
  expertiseType: ExpertiseType;
  status: ExpertVerificationStatus;
  size?: 'sm' | 'md';
}

export function ExpertBadge({
  expertiseType,
  status,
  size = 'sm',
}: ExpertBadgeProps) {
  if (status !== 'approved') return null;

  const label = EXPERTISE_LABELS[expertiseType] ?? expertiseType;
  const isSmall = size === 'sm';

  return (
    <View style={[styles.badge, isSmall ? styles.badgeSm : styles.badgeMd]}>
      <Ionicons
        name="shield-checkmark"
        size={isSmall ? 10 : 13}
        color="#059669"
      />
      <Text style={[styles.label, isSmall ? styles.labelSm : styles.labelMd]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    borderRadius: 4,
  },
  badgeSm: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    gap: 2,
  },
  badgeMd: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    gap: 3,
  },
  label: {
    color: '#059669',
    fontWeight: '600',
  },
  labelSm: {
    fontSize: 9,
  },
  labelMd: {
    fontSize: 11,
  },
});

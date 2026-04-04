import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface OfflineBadgeProps {
  size?: 'small' | 'normal';
}

export function OfflineBadge({ size = 'normal' }: OfflineBadgeProps) {
  const isSmall = size === 'small';

  return (
    <View style={[styles.badge, isSmall && styles.badgeSmall]}>
      <Ionicons
        name="cloud-done-outline"
        size={isSmall ? 10 : 12}
        color="#059669"
      />
      <Text style={[styles.text, isSmall && styles.textSmall]}>
        Offline
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ecfdf5',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  badgeSmall: {
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
    color: '#059669',
  },
  textSmall: {
    fontSize: 9,
  },
});

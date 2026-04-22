import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

interface GatedNoticeProps {
  typeLabel: string;
  upgradeTier: string | null;
}

export function GatedNotice({ typeLabel, upgradeTier }: GatedNoticeProps) {
  const tier = upgradeTier ?? 'edu';
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="lock-closed" size={16} color="#92400e" />
        <Text
          style={styles.title}
          accessibilityRole="header"
        >
          Unlock full content
        </Text>
      </View>
      <Text style={styles.body}>
        {typeLabel} answers and explanations are available on the{' '}
        <Text style={styles.bodyTier}>{tier}</Text> plan and above. Upgrade to see the full
        solution, model answer, and rationale.
      </Text>
      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        onPress={() => router.push('/subscription')}
        accessibilityRole="button"
        accessibilityLabel="Upgrade subscription"
      >
        <Text style={styles.buttonText}>Upgrade</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fef3c7',
    borderColor: '#fde68a',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 14, fontWeight: '700', color: '#92400e' },
  body: { fontSize: 13, color: '#78350f', lineHeight: 19 },
  bodyTier: { fontWeight: '700', textTransform: 'capitalize' },
  button: {
    alignSelf: 'flex-start',
    backgroundColor: '#92400e',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  buttonPressed: { opacity: 0.85 },
  buttonText: { color: '#fff', fontWeight: '600' },
});

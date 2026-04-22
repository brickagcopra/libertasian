import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export function Unavailable({
  message = 'Content unavailable — please regenerate.',
}: {
  message?: string;
}) {
  return (
    <View style={styles.container} accessibilityRole="alert">
      <Ionicons name="alert-circle-outline" size={16} color="#6b7280" />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    borderColor: '#e5e7eb',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
  },
  text: { flex: 1, fontSize: 13, color: '#4b5563' },
});

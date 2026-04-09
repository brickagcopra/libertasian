import { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

/**
 * Deep link target: libertasian://billing/success
 * Xendit redirects here after successful payment.
 * Invalidates billing queries and navigates to subscription screen.
 */
export default function BillingSuccessScreen() {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Refresh subscription and billing data
    queryClient.invalidateQueries({ queryKey: ['billing'] });

    // Navigate to subscription screen after a short delay
    const timer = setTimeout(() => {
      router.replace('/settings/subscription');
    }, 2500);

    return () => clearTimeout(timer);
  }, [queryClient]);

  return (
    <View style={styles.container}>
      <View style={styles.iconContainer}>
        <Ionicons name="checkmark-circle" size={64} color="#16a34a" />
      </View>
      <Text style={styles.title}>Payment Successful</Text>
      <Text style={styles.subtitle}>
        Your subscription has been activated. Redirecting...
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    padding: 32,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#f0fdf4',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 22,
  },
});

import { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

/**
 * Deep link target: libertasian://billing/cancel
 * Xendit redirects here when user cancels payment.
 * Navigates back to plans screen.
 */
export default function BillingCancelScreen() {
  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace('/settings/plans');
    }, 2500);

    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.iconContainer}>
        <Ionicons name="close-circle" size={64} color="#eab308" />
      </View>
      <Text style={styles.title}>Checkout Cancelled</Text>
      <Text style={styles.subtitle}>
        No charges were made. You can try again anytime. Redirecting...
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
    backgroundColor: '#fefce8',
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

import { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/providers/theme-provider';

/**
 * Deep link target: libertasian://billing/success
 * The web bounce page (apps/web /billing/mobile/success) hands off here
 * after Xendit payment. Invalidates billing queries and navigates to the
 * subscription screen.
 */
export default function BillingSuccessScreen() {
  const { theme } = useTheme();
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
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <View style={[styles.iconContainer, { backgroundColor: theme.accentSoft }]}>
        <Ionicons name="checkmark-circle" size={64} color={theme.accent} />
      </View>
      <Text style={[styles.title, { fontFamily: theme.serif, color: theme.ink }]}>
        Payment Successful
      </Text>
      <Text style={[styles.subtitle, { color: theme.inkSoft }]}>
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
    padding: 32,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    fontFamily: 'Inter_400Regular',
  },
});

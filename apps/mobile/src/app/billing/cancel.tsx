import { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/providers/theme-provider';

/**
 * Deep link target: libertasian://billing/cancel
 * The web bounce page (apps/web /billing/mobile/cancel) hands off here
 * when the user cancels payment. Navigates back to the plans screen.
 */
export default function BillingCancelScreen() {
  const { theme } = useTheme();

  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace('/settings/plans');
    }, 2500);

    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <View style={[styles.iconContainer, { backgroundColor: theme.surfaceMuted }]}>
        <Ionicons name="close-circle" size={64} color={theme.inkSoft} />
      </View>
      <Text style={[styles.title, { fontFamily: theme.serif, color: theme.ink }]}>
        Checkout Cancelled
      </Text>
      <Text style={[styles.subtitle, { color: theme.inkSoft }]}>
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

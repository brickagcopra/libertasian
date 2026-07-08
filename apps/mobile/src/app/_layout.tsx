import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts as useInterFonts,
} from '@expo-google-fonts/inter';
import {
  Fraunces_400Regular,
  Fraunces_500Medium,
  Fraunces_600SemiBold,
  useFonts as useFrauncesFonts,
} from '@expo-google-fonts/fraunces';
import {
  InstrumentSerif_400Regular,
  InstrumentSerif_400Regular_Italic,
  useFonts as useInstrumentSerifFonts,
} from '@expo-google-fonts/instrument-serif';
import { Slot, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { AuthProvider, useAuth } from '../providers/auth-provider';
import { ThemeProvider } from '../providers/theme-provider';
import { useNotificationSocket } from '../features/workspace/hooks/use-notifications';
import { usePushNotifications } from '../features/workspace/hooks/use-push-notifications';
import '../../global.css';

function AuthNavigationGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const segments = useSegments();

  // Socket-primary/poll-fallback notification center (parity with web) and
  // device push registration + tap deep-linking. Both no-op while signed out.
  useNotificationSocket(isAuthenticated);
  usePushNotifications(isAuthenticated);

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inPublicGroup = segments[0] === 'shared';
    const inOnboardingGroup = segments[0] === '(onboarding)';
    const inBillingDeepLink = segments[0] === 'billing';
    const hasCompletedOnboarding = !!user?.onboardingCompletedAt;

    if (inBillingDeepLink) return;

    if (!isAuthenticated && !inAuthGroup && !inPublicGroup) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      router.replace(hasCompletedOnboarding ? '/(tabs)' : '/(onboarding)');
    } else if (isAuthenticated && !hasCompletedOnboarding && !inOnboardingGroup) {
      router.replace('/(onboarding)');
    } else if (isAuthenticated && hasCompletedOnboarding && inOnboardingGroup) {
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, isLoading, segments, user]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1C1A14" />
      </View>
    );
  }

  return <>{children}</>;
}

export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            retry: 1,
          },
        },
      }),
  );

  const [interLoaded] = useInterFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const [frauncesLoaded] = useFrauncesFonts({
    Fraunces_400Regular,
    Fraunces_500Medium,
    Fraunces_600SemiBold,
  });
  const [instrumentLoaded] = useInstrumentSerifFonts({
    InstrumentSerif_400Regular,
    InstrumentSerif_400Regular_Italic,
  });

  const fontsLoaded = interLoaded && frauncesLoaded && instrumentLoaded;

  if (!fontsLoaded) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1C1A14" />
      </View>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <StatusBar style="auto" />
          <AuthNavigationGuard>
            <Slot />
          </AuthNavigationGuard>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F6F1E8',
  },
});

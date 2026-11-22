import { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-provider';

import {
  getSessionDisplacedSnapshot,
  setSessionDisplaced,
  subscribeSessionDisplaced,
} from './session-displaced';

export function useSessionDisplaced(): boolean {
  return useSyncExternalStore(subscribeSessionDisplaced, getSessionDisplacedSnapshot);
}

/**
 * Mounted once at the app root. Shown when the API answers 409
 * session_displaced: the plan allows only so many devices in use at once and
 * another device took this one's slot. "Use it here" claims it back (the other
 * device then sees this sheet) and refetches what failed. Not dismissable:
 * every authenticated request keeps failing until the user picks.
 */
export function SessionDisplacedHost() {
  const { theme } = useTheme();
  const { isAuthenticated, signOut } = useAuth();
  const displaced = useSessionDisplaced();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A flag left from a previous session must not greet the next sign-in.
  useEffect(() => {
    if (!isAuthenticated) setSessionDisplaced(false);
  }, [isAuthenticated]);

  const continueHere = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post('/auth/sessions/claim');
      setSessionDisplaced(false);
      await queryClient.invalidateQueries();
    } catch {
      setError('Could not switch to this device. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    setBusy(true);
    try {
      await signOut();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={displaced && isAuthenticated}
      animationType="fade"
      transparent
      onRequestClose={() => undefined}
    >
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: theme.surface, borderRadius: theme.radius }]}>
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: theme.ink, fontFamily: theme.serif }]}
          >
            You&apos;re using LIBERTASIAN on another device
          </Text>
          <Text style={[styles.body, { color: theme.inkSoft, fontFamily: theme.sans }]}>
            Your account can be used on a limited number of devices at the same time.
            Continue here and the other device will be paused.
          </Text>
          {error ? (
            <Text
              accessibilityRole="alert"
              style={[styles.error, { fontFamily: theme.sans }]}
            >
              {error}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void continueHere()}
            style={[styles.primary, { backgroundColor: theme.accent, borderRadius: theme.radius }]}
          >
            {busy ? (
              <ActivityIndicator color={theme.accentInk} />
            ) : (
              <Text style={[styles.primaryText, { color: theme.accentInk, fontFamily: theme.sans }]}>
                Use it here
              </Text>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void leave()}
            style={styles.secondary}
          >
            <Text style={[styles.secondaryText, { color: theme.inkSoft, fontFamily: theme.sans }]}>
              Sign out
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  card: { padding: 24 },
  title: { fontSize: 22, marginBottom: 8 },
  body: { fontSize: 15, lineHeight: 22, marginBottom: 16 },
  error: { fontSize: 14, lineHeight: 20, marginBottom: 12, color: '#B42318' },
  primary: { paddingVertical: 14, alignItems: 'center' },
  primaryText: { fontSize: 16, fontWeight: '600' },
  secondary: { paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  secondaryText: { fontSize: 15 },
});

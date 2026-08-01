import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { topInsetPadding, bottomInsetPadding } from '../../lib/safe-area';
import { Link, useLocalSearchParams } from 'expo-router';
import { useResetPassword } from '../../features/auth/hooks/use-auth';
import { APP_NAME } from '../../lib/constants';
import { ApiClientError } from '../../lib/api-client';

export default function ResetPasswordScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useLocalSearchParams<{ token?: string }>();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);

  const resetMutation = useResetPassword();

  function validate(): boolean {
    const newErrors: Record<string, string> = {};

    if (!newPassword) {
      newErrors['newPassword'] = 'Password is required';
    } else if (newPassword.length < 10) {
      newErrors['newPassword'] = 'Password must be at least 10 characters';
    }

    if (!confirmPassword) {
      newErrors['confirmPassword'] = 'Please confirm your password';
    } else if (confirmPassword !== newPassword) {
      newErrors['confirmPassword'] = 'Passwords do not match';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleReset() {
    if (!token || !validate()) return;

    try {
      await resetMutation.mutateAsync({
        token,
        newPassword,
      });
      setSuccess(true);
    } catch (error) {
      if (error instanceof ApiClientError) {
        if (error.statusCode === 400) {
          Alert.alert(
            'Invalid or Expired Link',
            'This reset link is no longer valid. Please request a new one.',
          );
        } else if (error.statusCode === 429) {
          Alert.alert(
            'Too Many Attempts',
            'Please wait a few minutes before trying again.',
          );
        } else {
          Alert.alert('Error', error.serverMessage);
        }
      } else {
        Alert.alert('Error', 'Unable to connect to the server. Please try again.');
      }
    }
  }

  // No token present — show warning
  if (!token) {
    return (
      <View style={styles.flex}>
        <View style={styles.centeredContainer}>
          <Text style={styles.appName}>{APP_NAME}</Text>
          <Text style={styles.title}>Invalid Reset Link</Text>
          <Text style={styles.subtitle}>
            This link is missing a reset token. Please use the link from your
            email, or request a new one.
          </Text>
          <Link href="/(auth)/forgot-password" asChild>
            <TouchableOpacity style={styles.button} activeOpacity={0.8}>
              <Text style={styles.buttonText}>Request New Link</Text>
            </TouchableOpacity>
          </Link>
          <Link href="/(auth)/login" asChild>
            <TouchableOpacity style={styles.linkButton} activeOpacity={0.8}>
              <Text style={styles.footerLink}>Back to Sign In</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </View>
    );
  }

  // Success state
  if (success) {
    return (
      <View style={styles.flex}>
        <View style={styles.centeredContainer}>
          <Text style={styles.appName}>{APP_NAME}</Text>
          <Text style={styles.title}>Password Reset</Text>
          <Text style={styles.subtitle}>
            Your password has been reset successfully. You can now sign in with
            your new password.
          </Text>
          <Link href="/(auth)/login" asChild>
            <TouchableOpacity style={styles.button} activeOpacity={0.8}>
              <Text style={styles.buttonText}>Sign In</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </View>
    );
  }

  // Reset form
  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={[
            styles.container,
            {
              paddingTop: topInsetPadding(insets, CARD_TOP_SPACING),
              paddingBottom: bottomInsetPadding(insets, CARD_BOTTOM_SPACING),
            },
          ]}
        >
          <View style={styles.header}>
            <Text style={styles.appName}>{APP_NAME}</Text>
            <Text style={styles.title}>Reset Password</Text>
            <Text style={styles.subtitle}>
              Enter your new password below.
            </Text>
          </View>

          <View style={styles.form}>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>New Password</Text>
              <TextInput
                style={[
                  styles.input,
                  errors['newPassword'] ? styles.inputError : null,
                ]}
                value={newPassword}
                onChangeText={(text) => {
                  setNewPassword(text);
                  if (errors['newPassword'])
                    setErrors((e) => ({ ...e, newPassword: '' }));
                }}
                placeholder="Minimum 10 characters"
                placeholderTextColor="#9ca3af"
                secureTextEntry
                autoComplete="new-password"
                editable={!resetMutation.isPending}
              />
              {errors['newPassword'] ? (
                <Text style={styles.errorText}>{errors['newPassword']}</Text>
              ) : null}
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Confirm Password</Text>
              <TextInput
                style={[
                  styles.input,
                  errors['confirmPassword'] ? styles.inputError : null,
                ]}
                value={confirmPassword}
                onChangeText={(text) => {
                  setConfirmPassword(text);
                  if (errors['confirmPassword'])
                    setErrors((e) => ({ ...e, confirmPassword: '' }));
                }}
                placeholder="Re-enter your password"
                placeholderTextColor="#9ca3af"
                secureTextEntry
                autoComplete="new-password"
                editable={!resetMutation.isPending}
              />
              {errors['confirmPassword'] ? (
                <Text style={styles.errorText}>{errors['confirmPassword']}</Text>
              ) : null}
            </View>

            <TouchableOpacity
              style={[
                styles.button,
                resetMutation.isPending ? styles.buttonDisabled : null,
              ]}
              onPress={handleReset}
              disabled={resetMutation.isPending}
              activeOpacity={0.8}
            >
              {resetMutation.isPending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.buttonText}>Reset Password</Text>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.footer}>
            <Link href="/(auth)/login" asChild>
              <TouchableOpacity>
                <Text style={styles.footerText}>
                  Remember your password?{' '}
                  <Text style={styles.footerLink}>Sign In</Text>
                </Text>
              </TouchableOpacity>
            </Link>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * Design defaults for the centered auth card. Both are overridden at the
 * usage site with topInsetPadding()/bottomInsetPadding(), so under Android
 * 15 edge-to-edge the heading can never be clipped by the status bar. Kept
 * as named constants rather than literals so the override is obviously the
 * source of truth.
 */
const CARD_TOP_SPACING = 80;
const CARD_BOTTOM_SPACING = 40;

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#fff' },
  scrollContent: { flexGrow: 1 },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: CARD_TOP_SPACING,
    paddingBottom: CARD_BOTTOM_SPACING,
    justifyContent: 'center',
  },
  centeredContainer: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: { marginBottom: 32 },
  appName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1a56db',
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginBottom: 8,
  },
  title: { fontSize: 28, fontWeight: 'bold', color: '#111827', marginBottom: 8 },
  subtitle: {
    fontSize: 15,
    color: '#6b7280',
    lineHeight: 22,
    textAlign: 'center',
  },
  form: { gap: 16 },
  fieldGroup: { gap: 6 },
  label: { fontSize: 14, fontWeight: '600', color: '#374151' },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111827',
    backgroundColor: '#f9fafb',
  },
  inputError: { borderColor: '#ef4444' },
  errorText: { fontSize: 13, color: '#ef4444' },
  button: {
    backgroundColor: '#1a56db',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  linkButton: { marginTop: 16 },
  footer: { marginTop: 32, alignItems: 'center' },
  footerText: { fontSize: 14, color: '#6b7280' },
  footerLink: { color: '#1a56db', fontWeight: '600', fontSize: 14 },
});

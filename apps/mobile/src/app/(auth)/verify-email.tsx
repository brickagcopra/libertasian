import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';

import { useResendVerification, useVerifyEmail } from '../../features/auth/hooks/use-auth';
import { ApiClientError } from '../../lib/api-client';
import { APP_NAME } from '../../lib/constants';
import { bottomInsetPadding, topInsetPadding } from '../../lib/safe-area';

const RESEND_COOLDOWN_SEC = 60;

/**
 * Enter the 6-digit code emailed at sign-up. Reached after registering and
 * whenever sign-in is refused with EMAIL_NOT_VERIFIED (the API emails a fresh
 * code at that moment). Password accounts cannot sign in until this succeeds.
 */
export default function VerifyEmailScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ email?: string }>();
  const email = (typeof params.email === 'string' ? params.email : '').trim().toLowerCase();

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SEC);
  const verify = useVerifyEmail();
  const resend = useResendVerification();

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function submit(value: string) {
    if (!email || value.length !== 6 || verify.isPending) return;
    setError(null);
    try {
      await verify.mutateAsync({ email, code: value });
      Alert.alert('Email verified', 'Your email is verified. Sign in to continue.', [
        { text: 'Sign in', onPress: () => router.replace('/(auth)/login') },
      ]);
    } catch (e) {
      setCode('');
      if (e instanceof ApiClientError && e.statusCode === 429) {
        setError('Too many attempts. Please wait a few minutes and try again.');
      } else if (e instanceof ApiClientError && e.statusCode === 400) {
        setError(e.serverMessage || 'That code is not valid. Check the email or request a new code.');
      } else {
        setError('Unable to connect to the server. Please try again.');
      }
    }
  }

  async function handleResend() {
    if (!email || cooldown > 0 || resend.isPending) return;
    setError(null);
    try {
      await resend.mutateAsync({ email });
      setCooldown(RESEND_COOLDOWN_SEC);
      Alert.alert('Code sent', `We sent a new 6-digit code to ${email}.`);
    } catch (e) {
      if (e instanceof ApiClientError && e.statusCode === 400) {
        // "Email is already verified" — nothing left to do but sign in.
        Alert.alert('Already verified', 'This email is already verified. Please sign in.', [
          { text: 'Sign in', onPress: () => router.replace('/(auth)/login') },
        ]);
      } else if (e instanceof ApiClientError && e.statusCode === 429) {
        setError('Too many requests. Please wait a few minutes before asking for another code.');
      } else {
        setError('Unable to send a new code. Please try again.');
      }
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View
          style={[
            styles.container,
            {
              paddingTop: topInsetPadding(insets, 80),
              paddingBottom: bottomInsetPadding(insets, 40),
            },
          ]}
        >
          <View style={styles.header}>
            <Text style={styles.appName}>{APP_NAME}</Text>
            <Text style={styles.title}>Verify your email</Text>
            <Text style={styles.subtitle}>
              {email
                ? `Enter the 6-digit code we sent to ${email}. You can also tap the link in that email.`
                : 'Open the verification email we sent you and tap its link, then sign in.'}
            </Text>
          </View>

          {email ? (
            <View style={styles.form}>
              <TextInput
                testID="verify-code-input"
                accessibilityLabel="Verification code"
                style={[styles.codeInput, error ? styles.inputError : null]}
                value={code}
                onChangeText={(text) => {
                  const digits = text.replace(/\D/g, '').slice(0, 6);
                  setCode(digits);
                  if (error) setError(null);
                  if (digits.length === 6) void submit(digits);
                }}
                placeholder="000000"
                placeholderTextColor="#9ca3af"
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                maxLength={6}
                autoFocus
                editable={!verify.isPending}
              />
              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <TouchableOpacity
                style={[
                  styles.button,
                  verify.isPending || code.length !== 6 ? styles.buttonDisabled : null,
                ]}
                onPress={() => void submit(code)}
                disabled={verify.isPending || code.length !== 6}
                activeOpacity={0.8}
              >
                {verify.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.buttonText}>Verify</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => void handleResend()}
                disabled={cooldown > 0 || resend.isPending}
                style={styles.resend}
              >
                <Text style={[styles.resendText, cooldown > 0 ? styles.resendDisabled : null]}>
                  {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={styles.footer}>
            <TouchableOpacity onPress={() => router.replace('/(auth)/login')}>
              <Text style={styles.footerText}>
                Already verified? <Text style={styles.footerLink}>Sign In</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#fff' },
  scrollContent: { flexGrow: 1 },
  container: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
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
  subtitle: { fontSize: 15, color: '#6b7280', lineHeight: 22 },
  form: { gap: 12 },
  codeInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingVertical: 14,
    fontSize: 28,
    letterSpacing: 10,
    textAlign: 'center',
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
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  resend: { alignItems: 'center', paddingVertical: 8 },
  resendText: { fontSize: 14, color: '#1a56db', fontWeight: '600' },
  resendDisabled: { color: '#9ca3af' },
  footer: { marginTop: 32, alignItems: 'center' },
  footerText: { fontSize: 14, color: '#6b7280' },
  footerLink: { color: '#1a56db', fontWeight: '600' },
});

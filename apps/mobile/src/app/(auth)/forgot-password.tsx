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
import { Link } from 'expo-router';
import { useForgotPassword } from '../../features/auth/hooks/use-auth';
import { APP_NAME } from '../../lib/constants';
import { ApiClientError } from '../../lib/api-client';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);

  const forgotMutation = useForgotPassword();

  function validate(): boolean {
    const newErrors: Record<string, string> = {};

    if (!email.trim()) {
      newErrors['email'] = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      newErrors['email'] = 'Enter a valid email address';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;

    try {
      await forgotMutation.mutateAsync({ email: email.trim().toLowerCase() });
      setSuccess(true);
    } catch (error) {
      // Anti-enumeration: show success regardless of whether the email exists
      if (error instanceof ApiClientError && error.statusCode === 429) {
        Alert.alert(
          'Too Many Attempts',
          'Please wait a few minutes before trying again.',
        );
      } else {
        setSuccess(true);
      }
    }
  }

  if (success) {
    return (
      <View style={styles.flex}>
        <View style={styles.successContainer}>
          <Text style={styles.appName}>{APP_NAME}</Text>
          <Text style={styles.title}>Check Your Inbox</Text>
          <Text style={styles.subtitle}>
            If an account exists for {email.trim().toLowerCase()}, we sent a
            password reset link. Please check your email and follow the
            instructions.
          </Text>
          <Link href="/(auth)/login" asChild>
            <TouchableOpacity style={styles.button} activeOpacity={0.8}>
              <Text style={styles.buttonText}>Back to Sign In</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.appName}>{APP_NAME}</Text>
            <Text style={styles.title}>Forgot Password</Text>
            <Text style={styles.subtitle}>
              Enter your email address and we&apos;ll send you a link to reset
              your password.
            </Text>
          </View>

          <View style={styles.form}>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={[styles.input, errors['email'] ? styles.inputError : null]}
                value={email}
                onChangeText={(text) => {
                  setEmail(text);
                  if (errors['email']) setErrors((e) => ({ ...e, email: '' }));
                }}
                placeholder="you@example.com"
                placeholderTextColor="#9ca3af"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                editable={!forgotMutation.isPending}
              />
              {errors['email'] ? (
                <Text style={styles.errorText}>{errors['email']}</Text>
              ) : null}
            </View>

            <TouchableOpacity
              style={[
                styles.button,
                forgotMutation.isPending ? styles.buttonDisabled : null,
              ]}
              onPress={handleSubmit}
              disabled={forgotMutation.isPending}
              activeOpacity={0.8}
            >
              {forgotMutation.isPending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.buttonText}>Send Reset Link</Text>
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

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#fff' },
  scrollContent: { flexGrow: 1 },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 80,
    paddingBottom: 40,
    justifyContent: 'center',
  },
  successContainer: {
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
  subtitle: { fontSize: 15, color: '#6b7280', lineHeight: 22 },
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
  footer: { marginTop: 32, alignItems: 'center' },
  footerText: { fontSize: 14, color: '#6b7280' },
  footerLink: { color: '#1a56db', fontWeight: '600' },
});

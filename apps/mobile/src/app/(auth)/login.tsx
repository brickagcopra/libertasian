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
import { Link, router } from 'expo-router';
import { useLogin } from '../../features/auth/hooks/use-auth';
import { useAuth } from '../../providers/auth-provider';
import { APP_NAME } from '../../lib/constants';
import { ApiClientError } from '../../lib/api-client';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [showMfa, setShowMfa] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { signIn } = useAuth();
  const loginMutation = useLogin();

  function validate(): boolean {
    const newErrors: Record<string, string> = {};

    if (!email.trim()) {
      newErrors['email'] = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      newErrors['email'] = 'Enter a valid email address';
    }

    if (!password) {
      newErrors['password'] = 'Password is required';
    }

    if (showMfa && !mfaCode.trim()) {
      newErrors['mfaCode'] = 'MFA code is required';
    } else if (showMfa && !/^\d{6}$/.test(mfaCode.trim())) {
      newErrors['mfaCode'] = 'Enter a 6-digit code';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleLogin() {
    if (!validate()) return;

    try {
      const result = await loginMutation.mutateAsync({
        email: email.trim().toLowerCase(),
        password,
        ...(showMfa && mfaCode.trim() ? { mfaCode: mfaCode.trim() } : {}),
      });

      if (result.mfaRequired && !showMfa) {
        setShowMfa(true);
        return;
      }

      await signIn(result.tokens.accessToken, result.tokens.refreshToken, result.user);
      router.replace(result.user.onboardingCompletedAt ? '/(tabs)' : '/(onboarding)');
    } catch (error) {
      if (error instanceof ApiClientError) {
        if (error.statusCode === 401) {
          Alert.alert('Login Failed', 'Invalid email or password.');
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
            <Text style={styles.title}>Sign In</Text>
            <Text style={styles.subtitle}>
              Access your legal research dashboard
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
                editable={!loginMutation.isPending}
              />
              {errors['email'] ? (
                <Text style={styles.errorText}>{errors['email']}</Text>
              ) : null}
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                style={[
                  styles.input,
                  errors['password'] ? styles.inputError : null,
                ]}
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  if (errors['password'])
                    setErrors((e) => ({ ...e, password: '' }));
                }}
                placeholder="Enter your password"
                placeholderTextColor="#9ca3af"
                secureTextEntry
                autoComplete="password"
                editable={!loginMutation.isPending}
              />
              {errors['password'] ? (
                <Text style={styles.errorText}>{errors['password']}</Text>
              ) : null}
            </View>

            {showMfa ? (
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>MFA Code</Text>
                <Text style={styles.helperText}>
                  Enter the 6-digit code from your authenticator app
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    errors['mfaCode'] ? styles.inputError : null,
                  ]}
                  value={mfaCode}
                  onChangeText={(text) => {
                    setMfaCode(text.replace(/\D/g, '').slice(0, 6));
                    if (errors['mfaCode'])
                      setErrors((e) => ({ ...e, mfaCode: '' }));
                  }}
                  placeholder="000000"
                  placeholderTextColor="#9ca3af"
                  keyboardType="number-pad"
                  maxLength={6}
                  autoComplete="one-time-code"
                  editable={!loginMutation.isPending}
                />
                {errors['mfaCode'] ? (
                  <Text style={styles.errorText}>{errors['mfaCode']}</Text>
                ) : null}
              </View>
            ) : null}

            <TouchableOpacity
              style={[
                styles.button,
                loginMutation.isPending ? styles.buttonDisabled : null,
              ]}
              onPress={handleLogin}
              disabled={loginMutation.isPending}
              activeOpacity={0.8}
            >
              {loginMutation.isPending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.buttonText}>
                  {showMfa ? 'Verify & Sign In' : 'Sign In'}
                </Text>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.footer}>
            <Link href="/(auth)/forgot-password" asChild>
              <TouchableOpacity style={{ marginBottom: 16 }}>
                <Text style={styles.footerLink}>Forgot password?</Text>
              </TouchableOpacity>
            </Link>
            <Link href="/(auth)/register" asChild>
              <TouchableOpacity>
                <Text style={styles.footerText}>
                  Don't have an account?{' '}
                  <Text style={styles.footerLink}>Create one</Text>
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
  helperText: { fontSize: 13, color: '#6b7280' },
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

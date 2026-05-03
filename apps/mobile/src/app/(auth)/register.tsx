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
import { useRegister } from '../../features/auth/hooks/use-auth';
import { APP_NAME } from '../../lib/constants';
import { ApiClientError } from '../../lib/api-client';

export default function RegisterScreen() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const registerMutation = useRegister();

  function validate(): boolean {
    const newErrors: Record<string, string> = {};

    if (!fullName.trim()) {
      newErrors['fullName'] = 'Full name is required';
    } else if (fullName.trim().length < 2) {
      newErrors['fullName'] = 'Name must be at least 2 characters';
    }

    if (!email.trim()) {
      newErrors['email'] = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      newErrors['email'] = 'Enter a valid email address';
    }

    if (!password) {
      newErrors['password'] = 'Password is required';
    } else if (password.length < 10) {
      newErrors['password'] = 'Password must be at least 10 characters';
    }

    if (!confirmPassword) {
      newErrors['confirmPassword'] = 'Please confirm your password';
    } else if (password !== confirmPassword) {
      newErrors['confirmPassword'] = 'Passwords do not match';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  function clearFieldError(field: string) {
    if (errors[field]) {
      setErrors((e) => ({ ...e, [field]: '' }));
    }
  }

  async function handleRegister() {
    if (!validate()) return;

    try {
      await registerMutation.mutateAsync({
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        password,
      });

      Alert.alert(
        'Account Created',
        'Check your email for a 6-digit verification code, then sign in.',
        [{ text: 'Sign In', onPress: () => router.replace('/(auth)/login') }],
      );
    } catch (error) {
      if (error instanceof ApiClientError) {
        if (error.statusCode === 409) {
          setErrors({ email: 'An account with this email already exists' });
        } else if (error.statusCode === 429) {
          Alert.alert(
            'Too Many Attempts',
            'Please wait a few minutes before trying again.',
          );
        } else if (
          error.serverMessage.toLowerCase().includes('password') &&
          error.serverMessage.toLowerCase().includes('breach')
        ) {
          setErrors({
            password:
              'This password has been found in a data breach. Please choose a different one.',
          });
        } else {
          Alert.alert('Registration Failed', error.serverMessage);
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
            <Text style={styles.title}>Create Account</Text>
            <Text style={styles.subtitle}>
              Join the Philippine legal AI platform
            </Text>
          </View>

          <View style={styles.form}>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Full Name</Text>
              <TextInput
                style={[
                  styles.input,
                  errors['fullName'] ? styles.inputError : null,
                ]}
                value={fullName}
                onChangeText={(text) => {
                  setFullName(text);
                  clearFieldError('fullName');
                }}
                placeholder="Juan Dela Cruz"
                placeholderTextColor="#9ca3af"
                autoCapitalize="words"
                autoCorrect={false}
                autoComplete="name"
                editable={!registerMutation.isPending}
              />
              {errors['fullName'] ? (
                <Text style={styles.errorText}>{errors['fullName']}</Text>
              ) : null}
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={[styles.input, errors['email'] ? styles.inputError : null]}
                value={email}
                onChangeText={(text) => {
                  setEmail(text);
                  clearFieldError('email');
                }}
                placeholder="you@example.com"
                placeholderTextColor="#9ca3af"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                editable={!registerMutation.isPending}
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
                  clearFieldError('password');
                }}
                placeholder="Minimum 10 characters"
                placeholderTextColor="#9ca3af"
                secureTextEntry
                autoComplete="new-password"
                editable={!registerMutation.isPending}
              />
              {errors['password'] ? (
                <Text style={styles.errorText}>{errors['password']}</Text>
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
                  clearFieldError('confirmPassword');
                }}
                placeholder="Re-enter your password"
                placeholderTextColor="#9ca3af"
                secureTextEntry
                autoComplete="new-password"
                editable={!registerMutation.isPending}
              />
              {errors['confirmPassword'] ? (
                <Text style={styles.errorText}>{errors['confirmPassword']}</Text>
              ) : null}
            </View>

            <TouchableOpacity
              style={[
                styles.button,
                registerMutation.isPending ? styles.buttonDisabled : null,
              ]}
              onPress={handleRegister}
              disabled={registerMutation.isPending}
              activeOpacity={0.8}
            >
              {registerMutation.isPending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.buttonText}>Create Account</Text>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.footer}>
            <Link href="/(auth)/login" asChild>
              <TouchableOpacity>
                <Text style={styles.footerText}>
                  Already have an account?{' '}
                  <Text style={styles.footerLink}>Sign in</Text>
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
    paddingTop: 60,
    paddingBottom: 40,
    justifyContent: 'center',
  },
  header: { marginBottom: 28 },
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
  form: { gap: 14 },
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
  footer: { marginTop: 28, alignItems: 'center' },
  footerText: { fontSize: 14, color: '#6b7280' },
  footerLink: { color: '#1a56db', fontWeight: '600' },
});

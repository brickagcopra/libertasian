import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { HeaderAmbient } from '@/components/ui/HeaderAmbient';
import { Input } from '@/components/ui/Input';
import { Logo } from '@/components/ui/Logo';
import { useRegister } from '@/features/auth/hooks/use-auth';
import { useTheme } from '@/providers/theme-provider';
import { ApiClientError } from '@/lib/api-client';

export default function RegisterRoute() {
  const { theme } = useTheme();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const registerMutation = useRegister();

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (!fullName.trim()) newErrors['fullName'] = 'Full name is required';
    else if (fullName.trim().length < 2) newErrors['fullName'] = 'Name must be at least 2 characters';
    if (!email.trim()) newErrors['email'] = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) newErrors['email'] = 'Enter a valid email address';
    if (!password) newErrors['password'] = 'Password is required';
    else if (password.length < 10) newErrors['password'] = 'Password must be at least 10 characters';
    if (!confirmPassword) newErrors['confirmPassword'] = 'Please confirm your password';
    else if (password !== confirmPassword) newErrors['confirmPassword'] = 'Passwords do not match';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  function clearFieldError(field: string) {
    if (errors[field]) setErrors((e) => ({ ...e, [field]: '' }));
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
        'Account created',
        'Check your email for a 6-digit verification code, then sign in.',
        [{ text: 'Sign in', onPress: () => router.replace('/(auth)/login') }],
      );
    } catch (error) {
      if (error instanceof ApiClientError) {
        if (error.statusCode === 409) {
          setErrors({ email: 'An account with this email already exists' });
        } else if (error.statusCode === 429) {
          Alert.alert('Too many attempts', 'Please wait a few minutes before trying again.');
        } else if (
          error.serverMessage.toLowerCase().includes('password') &&
          error.serverMessage.toLowerCase().includes('breach')
        ) {
          setErrors({
            password:
              'This password has been found in a data breach. Please choose a different one.',
          });
        } else {
          Alert.alert('Registration failed', error.serverMessage);
        }
      } else {
        Alert.alert('Error', 'Unable to connect to the server. Please try again.');
      }
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <HeaderAmbient />
      <ScrollView
        contentContainerStyle={{
          paddingTop: 64,
          paddingBottom: 24,
          paddingHorizontal: 22,
          flexGrow: 1,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Pressable
            onPress={() => router.back()}
            accessibilityLabel="Go back"
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              borderWidth: 1,
              borderColor: theme.line,
              backgroundColor: theme.surface,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="chevron-back" size={18} color={theme.ink} />
          </Pressable>
          <Logo size={22} />
          <View style={{ width: 40 }} />
        </View>

        <View style={{ height: 30 }} />
        <Text
          style={{
            fontFamily: 'Inter_600SemiBold',
            fontSize: 12,
            color: theme.accent,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
          }}
        >
          Step 1 of 3
        </Text>
        <Text
          style={{
            marginTop: 6,
            fontFamily: theme.serif,
            fontSize: 32,
            lineHeight: 33.6,
            letterSpacing: -1,
            color: theme.ink,
          }}
        >
          Create your account.
        </Text>
        <Text
          style={{
            marginTop: 10,
            fontFamily: 'Inter_400Regular',
            fontSize: 14,
            color: theme.inkSoft,
          }}
        >
          A few basics — we&apos;ll tune the experience to you next.
        </Text>

        <View style={{ height: 22 }} />
        <View style={{ gap: 14 }}>
          <Input
            label="Full name"
            value={fullName}
            onChangeText={(t) => {
              setFullName(t);
              clearFieldError('fullName');
            }}
            placeholder="Juan Dela Cruz"
            autoCapitalize="words"
            autoComplete="name"
            error={errors['fullName'] || undefined}
            leading={<Ionicons name="person-outline" size={18} color={theme.inkFaint} />}
            editable={!registerMutation.isPending}
          />
          <Input
            label="Email"
            value={email}
            onChangeText={(t) => {
              setEmail(t);
              clearFieldError('email');
            }}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            error={errors['email'] || undefined}
            leading={<Ionicons name="mail-outline" size={18} color={theme.inkFaint} />}
            editable={!registerMutation.isPending}
          />
          <Input
            label="Password"
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              clearFieldError('password');
            }}
            placeholder="Minimum 10 characters"
            secureTextEntry
            autoComplete="new-password"
            error={errors['password'] || undefined}
            leading={<Ionicons name="lock-closed-outline" size={18} color={theme.inkFaint} />}
            editable={!registerMutation.isPending}
          />
          <Input
            label="Confirm password"
            value={confirmPassword}
            onChangeText={(t) => {
              setConfirmPassword(t);
              clearFieldError('confirmPassword');
            }}
            placeholder="Re-enter your password"
            secureTextEntry
            autoComplete="new-password"
            error={errors['confirmPassword'] || undefined}
            leading={<Ionicons name="lock-closed-outline" size={18} color={theme.inkFaint} />}
            editable={!registerMutation.isPending}
          />
        </View>

        <View style={{ flex: 1, minHeight: 24 }} />
        <View style={{ marginTop: 24 }}>
          <Button
            label={registerMutation.isPending ? 'Creating…' : 'Create account'}
            variant="primary"
            full
            disabled={registerMutation.isPending}
            onPress={handleRegister}
          />
        </View>

        <Pressable
          onPress={() => router.replace('/(auth)/login')}
          style={{ marginTop: 16, paddingVertical: 8 }}
        >
          <Text
            style={{
              textAlign: 'center',
              fontFamily: 'Inter_400Regular',
              fontSize: 13,
              color: theme.inkSoft,
            }}
          >
            Already have an account?{' '}
            <Text style={{ color: theme.ink, fontFamily: 'Inter_600SemiBold' }}>Sign in</Text>
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

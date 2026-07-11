import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { LoginScreen as LoginScreenView } from '@/components/screens/LoginScreen';
import { useLogin } from '@/features/auth/hooks/use-auth';
import {
  isGoogleSignInAvailable,
  useSocialLogin,
} from '@/features/auth/hooks/use-social-login';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-provider';
import { ApiClientError } from '@/lib/api-client';

export default function LoginRoute() {
  const { theme } = useTheme();
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [pendingPassword, setPendingPassword] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [passwordError, setPasswordError] = useState<string | undefined>(undefined);

  const { signIn } = useAuth();
  const loginMutation = useLogin();
  const { signInWithGoogle, signInWithApple } = useSocialLogin();

  async function handleGoogle() {
    // Build shipped without the Google client IDs → keep the old stub alert.
    if (!isGoogleSignInAvailable()) {
      Alert.alert('Coming soon', 'Google sign-in is not yet enabled.');
      return;
    }
    const outcome = await signInWithGoogle();
    // 'cancelled' is a deliberate user action — silent no-op, never an error.
    if (outcome === 'failed') {
      Alert.alert('Sign-in failed', "We couldn't sign you in with Google. Please try again.");
    }
  }

  async function handleApple() {
    const outcome = await signInWithApple();
    if (outcome === 'failed') {
      Alert.alert('Sign-in failed', "We couldn't sign you in with Apple. Please try again.");
    }
  }

  function validate(email: string, password: string): boolean {
    let ok = true;
    if (!email.trim()) {
      setEmailError('Email is required');
      ok = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setEmailError('Enter a valid email address');
      ok = false;
    } else {
      setEmailError(undefined);
    }
    if (!password) {
      setPasswordError('Password is required');
      ok = false;
    } else {
      setPasswordError(undefined);
    }
    return ok;
  }

  async function attemptLogin(email: string, password: string, mfa?: string) {
    if (!mfa && !validate(email, password)) return;
    setError(null);
    setMfaError(null);
    try {
      const result = await loginMutation.mutateAsync({
        email: email.trim().toLowerCase(),
        password,
        ...(mfa && mfa.trim() ? { mfaCode: mfa.trim() } : {}),
      });

      if (result.mfaRequired && !mfa) {
        setPendingEmail(email);
        setPendingPassword(password);
        return;
      }

      await signIn(result.tokens.accessToken, result.tokens.refreshToken, result.user);
      router.replace(result.user.onboardingCompletedAt ? '/(tabs)' : '/(onboarding)');
    } catch (e) {
      if (e instanceof ApiClientError) {
        if (e.statusCode === 401) {
          if (mfa) setMfaError('Invalid MFA code.');
          else setError('Invalid email or password.');
        } else if (e.statusCode === 429) {
          Alert.alert('Too Many Attempts', 'Please wait a few minutes before trying again.');
        } else {
          setError(e.serverMessage);
        }
      } else {
        setError('Unable to connect to the server. Please try again.');
      }
    }
  }

  const showMfa = pendingEmail !== null && pendingPassword !== null;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <LoginScreenView
        loading={loginMutation.isPending}
        error={error}
        emailError={emailError}
        passwordError={passwordError}
        onBack={() => router.back()}
        onSubmit={(email, password) => attemptLogin(email, password)}
        onForgot={() => router.push('/(auth)/forgot-password')}
        onCreateAccount={() => router.push('/(auth)/register')}
        onApple={handleApple}
        onGoogle={handleGoogle}
        onSSO={() => Alert.alert('Coming soon', 'SSO is not yet enabled.')}
        showApple={Platform.OS === 'ios'}
      />

      <Modal visible={showMfa} animationType="slide" transparent onRequestClose={() => setPendingEmail(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View
            style={{
              backgroundColor: theme.bg,
              padding: 22,
              paddingBottom: 36,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
            }}
          >
            <Text
              style={{
                fontFamily: theme.serif,
                fontSize: 26,
                letterSpacing: -0.6,
                color: theme.ink,
              }}
            >
              Two-step verification
            </Text>
            <Text
              style={{
                marginTop: 8,
                fontFamily: 'Inter_400Regular',
                fontSize: 14,
                color: theme.inkSoft,
              }}
            >
              Enter the 6-digit code from your authenticator app.
            </Text>
            <View style={{ height: 16 }} />
            <Input
              label="MFA code"
              value={mfaCode}
              onChangeText={(t) => setMfaCode(t.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              keyboardType="number-pad"
              autoComplete="one-time-code"
              maxLength={6}
              error={mfaError ?? undefined}
            />
            <View style={{ height: 16 }} />
            <Button
              label={loginMutation.isPending ? 'Verifying…' : 'Verify & sign in'}
              variant="primary"
              full
              disabled={loginMutation.isPending || mfaCode.length !== 6}
              onPress={() => {
                if (pendingEmail && pendingPassword) {
                  attemptLogin(pendingEmail, pendingPassword, mfaCode);
                }
              }}
            />
            <View style={{ height: 8 }} />
            <Pressable
              onPress={() => {
                setPendingEmail(null);
                setPendingPassword(null);
                setMfaCode('');
                setMfaError(null);
              }}
              style={{ paddingVertical: 12, alignItems: 'center' }}
            >
              <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 14, color: theme.inkSoft }}>
                Cancel
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

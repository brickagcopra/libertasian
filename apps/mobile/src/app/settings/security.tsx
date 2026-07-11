import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import {
  useChangePassword,
  useConfirmMfa,
  useDisableMfa,
  useEnrollMfa,
} from '@/features/settings/hooks/use-security';
import type { MfaEnrollResult } from '@/features/settings/types';
import { useProfile } from '@/features/auth/hooks/use-auth';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-provider';
import { ApiClientError } from '@/lib/api-client';

const MONO_FONT = Platform.select({ ios: 'Menlo', default: 'monospace' });

function SectionTitle({ title, sub }: { title: string; sub?: string }) {
  const { theme } = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <Text
        style={{
          fontFamily: 'Inter_600SemiBold',
          fontSize: 17,
          letterSpacing: -0.2,
          color: theme.ink,
        }}
      >
        {title}
      </Text>
      {sub ? (
        <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: theme.inkSoft }}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

function ChangePasswordCard() {
  const { signOut } = useAuth();
  const changePassword = useChangePassword();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentError, setCurrentError] = useState<string | undefined>(undefined);
  const [newError, setNewError] = useState<string | undefined>(undefined);
  const [confirmError, setConfirmError] = useState<string | undefined>(undefined);

  function validate(): boolean {
    let ok = true;
    if (!currentPassword) {
      setCurrentError('Current password is required');
      ok = false;
    } else {
      setCurrentError(undefined);
    }
    if (newPassword.length < 10) {
      setNewError('New password must be at least 10 characters');
      ok = false;
    } else if (newPassword === currentPassword) {
      setNewError('New password must differ from your current password');
      ok = false;
    } else {
      setNewError(undefined);
    }
    if (confirmPassword !== newPassword) {
      setConfirmError('Passwords do not match');
      ok = false;
    } else {
      setConfirmError(undefined);
    }
    return ok;
  }

  async function handleSubmit() {
    if (!validate()) return;
    try {
      await changePassword.mutateAsync({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      // The API revokes ALL refresh tokens on success — this session is dead.
      // Mirror web settings: confirm, then sign out and land on login.
      Alert.alert(
        'Password updated',
        'Your password was changed. Signing you out — please sign in again with your new password.',
        [
          {
            text: 'OK',
            onPress: () => {
              void signOut().then(() => router.replace('/(auth)/login'));
            },
          },
        ],
      );
    } catch (e) {
      if (e instanceof ApiClientError && e.statusCode === 401) {
        setCurrentError('Current password is incorrect');
      } else if (e instanceof ApiClientError) {
        Alert.alert('Could not change password', e.serverMessage);
      } else {
        Alert.alert('Could not change password', 'Unable to connect to the server. Please try again.');
      }
    }
  }

  return (
    <Card>
      <View style={{ gap: 14 }}>
        <SectionTitle
          title="Change password"
          sub="You will be signed out of all devices after changing your password."
        />
        <Input
          label="Current password"
          value={currentPassword}
          onChangeText={setCurrentPassword}
          placeholder="Enter current password"
          secureTextEntry
          autoComplete="current-password"
          autoCapitalize="none"
          error={currentError}
        />
        <Input
          label="New password"
          value={newPassword}
          onChangeText={setNewPassword}
          placeholder="At least 10 characters"
          secureTextEntry
          autoComplete="new-password"
          autoCapitalize="none"
          error={newError}
        />
        <Input
          label="Confirm new password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder="Re-enter new password"
          secureTextEntry
          autoComplete="new-password"
          autoCapitalize="none"
          error={confirmError}
        />
        <Button
          label={changePassword.isPending ? 'Updating…' : 'Update password'}
          variant="primary"
          full
          disabled={changePassword.isPending}
          onPress={() => void handleSubmit()}
        />
      </View>
    </Card>
  );
}

function MfaEnrollSetup({
  enrollData,
  onDone,
  onCancel,
}: {
  enrollData: MfaEnrollResult;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { theme } = useTheme();
  const confirmMfa = useConfirmMfa();
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  async function handleCopySecret() {
    await Clipboard.setStringAsync(enrollData.secret);
    setCopied(true);
  }

  async function handleOpenAuthenticator() {
    try {
      await Linking.openURL(enrollData.otpauthUrl);
    } catch {
      Alert.alert(
        'No authenticator app found',
        'Copy the secret key above and enter it manually in your authenticator app.',
      );
    }
  }

  async function handleVerify() {
    if (code.length !== 6) return;
    setCodeError(undefined);
    try {
      await confirmMfa.mutateAsync(code);
      Alert.alert('MFA enabled', 'Two-factor authentication is now active on your account.');
      onDone();
    } catch (e) {
      if (e instanceof ApiClientError && e.statusCode === 401) {
        setCodeError('Invalid MFA code. Please try again.');
      } else if (e instanceof ApiClientError) {
        Alert.alert('Could not enable MFA', e.serverMessage);
      } else {
        Alert.alert('Could not enable MFA', 'Unable to connect to the server. Please try again.');
      }
    }
  }

  return (
    <View style={{ gap: 14 }}>
      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: theme.inkSoft }}>
        Add this secret to your authenticator app, then enter the 6-digit code it generates.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Copy secret key"
        onPress={() => void handleCopySecret()}
        style={{
          borderRadius: 14,
          backgroundColor: theme.surfaceMuted,
          borderWidth: 1,
          borderColor: theme.line,
          paddingVertical: 12,
          paddingHorizontal: 14,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <Text
          selectable
          style={{
            flex: 1,
            fontFamily: MONO_FONT,
            fontSize: 14,
            letterSpacing: 1,
            color: theme.ink,
          }}
        >
          {enrollData.secret}
        </Text>
        <Ionicons
          name={copied ? 'checkmark-outline' : 'copy-outline'}
          size={18}
          color={theme.inkSoft}
        />
      </Pressable>
      {copied ? (
        <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: theme.inkSoft }}>
          Secret copied to clipboard.
        </Text>
      ) : null}
      <Button
        label="Open in authenticator app"
        variant="primary"
        full
        onPress={() => void handleOpenAuthenticator()}
      />
      <Input
        label="6-digit code"
        value={code}
        onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
        placeholder="000000"
        keyboardType="number-pad"
        autoComplete="one-time-code"
        maxLength={6}
        error={codeError}
      />
      <Button
        label={confirmMfa.isPending ? 'Verifying…' : 'Verify & enable'}
        variant="accent"
        full
        disabled={confirmMfa.isPending || code.length !== 6}
        onPress={() => void handleVerify()}
      />
      <Pressable onPress={onCancel} style={{ paddingVertical: 10, alignItems: 'center' }}>
        <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 14, color: theme.inkSoft }}>
          Cancel setup
        </Text>
      </Pressable>
    </View>
  );
}

function MfaDisableForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { theme } = useTheme();
  const disableMfa = useDisableMfa();
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | undefined>(undefined);

  async function submitDisable() {
    try {
      await disableMfa.mutateAsync(password);
      Alert.alert('MFA disabled', 'Two-factor authentication has been turned off.');
      onDone();
    } catch (e) {
      if (e instanceof ApiClientError && e.statusCode === 401) {
        setPasswordError('Invalid password');
      } else if (e instanceof ApiClientError) {
        Alert.alert('Could not disable MFA', e.serverMessage);
      } else {
        Alert.alert('Could not disable MFA', 'Unable to connect to the server. Please try again.');
      }
    }
  }

  function handleDisablePress() {
    if (!password) {
      setPasswordError('Password is required');
      return;
    }
    setPasswordError(undefined);
    Alert.alert(
      'Disable MFA?',
      'Your account will no longer require an authenticator code at sign-in. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disable', style: 'destructive', onPress: () => void submitDisable() },
      ],
    );
  }

  return (
    <View style={{ gap: 14 }}>
      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: theme.inkSoft }}>
        Confirm your password to disable two-factor authentication.
      </Text>
      <Input
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="Enter your password"
        secureTextEntry
        autoComplete="current-password"
        autoCapitalize="none"
        error={passwordError}
      />
      <Button
        label={disableMfa.isPending ? 'Disabling…' : 'Disable MFA'}
        variant="destructive"
        full
        disabled={disableMfa.isPending}
        onPress={handleDisablePress}
      />
      <Pressable onPress={onCancel} style={{ paddingVertical: 10, alignItems: 'center' }}>
        <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 14, color: theme.inkSoft }}>
          Cancel
        </Text>
      </Pressable>
    </View>
  );
}

function MfaCard() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const enrollMfa = useEnrollMfa();

  const [enrollData, setEnrollData] = useState<MfaEnrollResult | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);

  const mfaEnabled = profile?.mfaEnabled ?? user?.mfaEnabled ?? false;

  async function handleEnroll() {
    try {
      const result = await enrollMfa.mutateAsync();
      setEnrollData(result);
    } catch (e) {
      if (e instanceof ApiClientError) {
        Alert.alert('Could not start MFA setup', e.serverMessage);
      } else {
        Alert.alert('Could not start MFA setup', 'Unable to connect to the server. Please try again.');
      }
    }
  }

  return (
    <Card>
      <View style={{ gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <SectionTitle
              title="Two-factor authentication"
              sub="Protect your account with a 6-digit code from an authenticator app."
            />
          </View>
          <View
            style={{
              borderRadius: 999,
              paddingHorizontal: 10,
              paddingVertical: 4,
              backgroundColor: mfaEnabled ? theme.accentSoft : theme.surfaceMuted,
            }}
          >
            <Text
              style={{
                fontFamily: 'Inter_600SemiBold',
                fontSize: 12,
                color: theme.ink,
              }}
            >
              {mfaEnabled ? 'On' : 'Off'}
            </Text>
          </View>
        </View>

        {mfaEnabled ? (
          disableOpen ? (
            <MfaDisableForm
              onDone={() => setDisableOpen(false)}
              onCancel={() => setDisableOpen(false)}
            />
          ) : (
            <Button
              label="Disable MFA"
              variant="secondary"
              full
              onPress={() => setDisableOpen(true)}
            />
          )
        ) : enrollData ? (
          <MfaEnrollSetup
            enrollData={enrollData}
            onDone={() => setEnrollData(null)}
            onCancel={() => setEnrollData(null)}
          />
        ) : (
          <Button
            label={enrollMfa.isPending ? 'Preparing…' : 'Enable MFA'}
            variant="primary"
            full
            disabled={enrollMfa.isPending}
            onPress={() => void handleEnroll()}
          />
        )}
      </View>
    </Card>
  );
}

export default function SecurityRoute() {
  const { theme } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          <ChangePasswordCard />
          <MfaCard />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

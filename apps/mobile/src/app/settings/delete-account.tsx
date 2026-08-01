import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useDeleteAccount } from '@/features/settings/hooks/use-account-deletion';
import { useProfile } from '@/features/auth/hooks/use-auth';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-provider';
import { ApiClientError } from '@/lib/api-client';
import { mmkvStorage } from '@/storage/mmkv';
import { clearAllCachedData } from '@/storage/sqlite';

/** The destructive red used across the app. */
const DESTRUCTIVE = '#dc2626';
const DESTRUCTIVE_SOFT = 'rgba(220,38,38,0.10)';

/** The literal the user must type to arm the delete. */
const CONFIRM_WORD = 'DELETE';

/** What the account deletion actually removes, in the user's terms. */
const REMOVED = [
  'Your profile, email address and password',
  'Notes, bookmarks and highlights',
  'Uploaded documents and camera scans',
  'Private digests you generated',
  'Matters and workspace data',
];

function Bullet({ text, tone }: { text: string; tone: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
      <Text style={{ color: tone, fontSize: 13, lineHeight: 19 }}>•</Text>
      <Text
        style={{
          flex: 1,
          fontFamily: 'Inter_400Regular',
          fontSize: 13,
          lineHeight: 19,
          color: tone,
        }}
      >
        {text}
      </Text>
    </View>
  );
}

export default function DeleteAccountRoute() {
  const { theme } = useTheme();
  // PR 4 moves the whole app onto insets for Android 15 edge-to-edge; this
  // screen starts there rather than hardcoding a paddingTop that would only
  // have to be removed.
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const { data: profile } = useProfile();
  const account = profile ?? user;
  const deleteAccount = useDeleteAccount();

  // Social-only accounts (Google/Apple) have no password hash to compare, so
  // the API asks them to echo their email instead. Default to the password
  // branch when the profile has not loaded — it is the stricter of the two.
  const hasPassword = account?.hasPassword !== false;

  const [confirmWord, setConfirmWord] = useState('');
  const [credential, setCredential] = useState('');
  const [confirmError, setConfirmError] = useState<string | undefined>();
  const [credentialError, setCredentialError] = useState<string | undefined>();
  const [blockedMessage, setBlockedMessage] = useState<string | undefined>();

  const confirmed = confirmWord.trim() === CONFIRM_WORD;
  const canSubmit =
    confirmed && credential.trim().length > 0 && !deleteAccount.isPending;

  async function clearLocalData() {
    // Best-effort: the account is already deactivated server-side, so a
    // storage failure must not strand the user in a half-signed-in state.
    try {
      mmkvStorage.clearAll();
    } catch {
      // ignore
    }
    try {
      await clearAllCachedData();
    } catch {
      // ignore
    }
  }

  async function finish() {
    await clearLocalData();
    await signOut();
    router.replace('/(auth)/login');
  }

  async function handleDelete() {
    setBlockedMessage(undefined);

    if (!confirmed) {
      setConfirmError(`Type ${CONFIRM_WORD} to confirm`);
      return;
    }
    setConfirmError(undefined);

    if (!credential.trim()) {
      setCredentialError(
        hasPassword
          ? 'Your password is required'
          : 'Your account email is required',
      );
      return;
    }
    setCredentialError(undefined);

    try {
      const result = await deleteAccount.mutateAsync({
        confirm: CONFIRM_WORD,
        ...(hasPassword
          ? { password: credential }
          : { email: credential.trim() }),
      });

      Alert.alert(
        'Account deleted',
        `Your account has been deactivated and you have been signed out.\n\n` +
          `We emailed ${account?.email ?? 'your address'} a link that restores ` +
          `everything if you change your mind. It works for ` +
          `${result.restoreWindowDays} days — after that the deletion is permanent.`,
        [{ text: 'OK', onPress: () => void finish() }],
      );
    } catch (e) {
      if (e instanceof ApiClientError && e.statusCode === 409) {
        // The server names the members who would be stranded. That message is
        // the actionable one — show it verbatim rather than paraphrasing.
        setBlockedMessage(e.serverMessage);
      } else if (e instanceof ApiClientError && e.statusCode === 401) {
        setCredentialError(
          hasPassword
            ? 'Incorrect password'
            : 'That email does not match this account',
        );
      } else if (e instanceof ApiClientError) {
        Alert.alert('Could not delete account', e.serverMessage);
      } else {
        Alert.alert(
          'Could not delete account',
          'Unable to connect to the server. Please try again.',
        );
      }
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={{
            padding: 16,
            // The native stack header already consumes the top inset, so only
            // the bottom one is ours to add — that is the edge Android 15
            // edge-to-edge actually exposes here (gesture nav bar). Taking it
            // from useSafeAreaInsets rather than a hardcoded constant is the
            // pattern PR 4 rolls out across the rest of the app.
            paddingBottom: insets.bottom + 40,
            gap: 16,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Step 1 — what happens, stated before anything is typed. */}
          <Card>
            <View style={{ gap: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    backgroundColor: DESTRUCTIVE_SOFT,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name="trash-outline" size={16} color={DESTRUCTIVE} />
                </View>
                <Text
                  style={{
                    fontFamily: 'Inter_600SemiBold',
                    fontSize: 17,
                    letterSpacing: -0.2,
                    color: theme.ink,
                  }}
                >
                  Delete your account
                </Text>
              </View>

              <Text
                style={{
                  fontFamily: 'Inter_400Regular',
                  fontSize: 13,
                  lineHeight: 19,
                  color: theme.inkSoft,
                }}
              >
                Your account is deactivated immediately and you are signed out
                everywhere. These are permanently deleted after 30 days:
              </Text>

              <View style={{ gap: 6 }}>
                {REMOVED.map((item) => (
                  <Bullet key={item} text={item} tone={theme.inkSoft} />
                ))}
              </View>

              <View
                style={{
                  borderRadius: 10,
                  padding: 12,
                  backgroundColor: theme.accentSoft,
                  gap: 4,
                }}
              >
                <Text
                  style={{
                    fontFamily: 'Inter_600SemiBold',
                    fontSize: 13,
                    color: theme.ink,
                  }}
                >
                  You have 30 days to change your mind
                </Text>
                <Text
                  style={{
                    fontFamily: 'Inter_400Regular',
                    fontSize: 12,
                    lineHeight: 18,
                    color: theme.inkSoft,
                  }}
                >
                  We email you a link that restores your account and everything
                  in it. After 30 days the deletion is permanent and cannot be
                  undone.
                </Text>
              </View>
            </View>
          </Card>

          {/* Step 2 — the two-step confirmation. */}
          <Card>
            <View style={{ gap: 14 }}>
              <Text
                style={{
                  fontFamily: 'Inter_600SemiBold',
                  fontSize: 15,
                  color: theme.ink,
                }}
              >
                Confirm
              </Text>

              <Input
                label={`Type ${CONFIRM_WORD} to continue`}
                value={confirmWord}
                onChangeText={(t) => {
                  setConfirmWord(t);
                  if (confirmError) setConfirmError(undefined);
                }}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder={CONFIRM_WORD}
                error={confirmError}
                testID="delete-account-confirm-input"
              />

              {confirmed ? (
                <Input
                  label={hasPassword ? 'Your password' : 'Your account email'}
                  value={credential}
                  onChangeText={(t) => {
                    setCredential(t);
                    if (credentialError) setCredentialError(undefined);
                  }}
                  secureTextEntry={hasPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType={hasPassword ? 'default' : 'email-address'}
                  placeholder={
                    hasPassword ? 'Enter your password' : account?.email ?? ''
                  }
                  error={credentialError}
                  testID="delete-account-credential-input"
                />
              ) : null}

              {blockedMessage ? (
                <View
                  style={{
                    borderRadius: 10,
                    padding: 12,
                    backgroundColor: DESTRUCTIVE_SOFT,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: 'Inter_400Regular',
                      fontSize: 12,
                      lineHeight: 18,
                      color: DESTRUCTIVE,
                    }}
                    testID="delete-account-blocked-message"
                  >
                    {blockedMessage}
                  </Text>
                </View>
              ) : null}

              <Button
                label={
                  deleteAccount.isPending ? 'Deleting…' : 'Delete my account'
                }
                variant="primary"
                full
                disabled={!canSubmit}
                style={
                  canSubmit ? { backgroundColor: DESTRUCTIVE } : undefined
                }
                onPress={() => void handleDelete()}
                testID="delete-account-submit"
              />
              <Button
                label="Cancel"
                variant="secondary"
                full
                disabled={deleteAccount.isPending}
                onPress={() => router.back()}
              />
            </View>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

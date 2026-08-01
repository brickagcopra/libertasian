import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/Button';
import { HeaderAmbient } from '@/components/ui/HeaderAmbient';
import { Input } from '@/components/ui/Input';
import { Logo } from '@/components/ui/Logo';
import { topInsetPadding, bottomInsetPadding } from '@/lib/safe-area';
import { useTheme } from '@/providers/theme-provider';

export interface LoginScreenProps {
  onBack?: () => void;
  onSubmit?: (email: string, password: string, keepSignedIn: boolean) => void;
  onForgot?: () => void;
  onCreateAccount?: () => void;
  onApple?: () => void;
  onGoogle?: () => void;
  onSSO?: () => void;
  /** Apple guideline 4.8 — the Apple button is iOS-only; Android hides it. */
  showApple?: boolean;
  loading?: boolean;
  error?: string | null;
  defaultEmail?: string;
  /** Inline per-field validation errors. */
  emailError?: string;
  passwordError?: string;
}

export function LoginScreen({
  onBack,
  onSubmit,
  onForgot,
  onCreateAccount,
  onApple,
  onGoogle,
  onSSO,
  showApple = true,
  loading = false,
  error,
  defaultEmail = '',
  emailError,
  passwordError,
}: LoginScreenProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState('');
  const [keep, setKeep] = useState(true);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <HeaderAmbient />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: topInsetPadding(insets, 64),
          paddingBottom: bottomInsetPadding(insets, 24),
          paddingHorizontal: 22,
          flexGrow: 1,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Pressable
            onPress={onBack}
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

        <View style={{ height: 36 }} />
        <Text
          style={{
            fontFamily: theme.serif,
            fontSize: 36,
            lineHeight: 37.8,
            letterSpacing: -1.2,
            color: theme.ink,
          }}
        >
          Welcome back.
        </Text>
        <Text
          style={{
            marginTop: 10,
            fontFamily: 'Inter_400Regular',
            fontSize: 15,
            color: theme.inkSoft,
          }}
        >
          Pick up where you left off.
        </Text>

        <View style={{ height: 28 }} />
        <View style={{ gap: 14 }}>
          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            error={emailError}
            leading={<Ionicons name="mail-outline" size={18} color={theme.inkFaint} />}
          />
          <Input
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            secureTextEntry
            autoComplete="password"
            error={passwordError}
            leading={<Ionicons name="lock-closed-outline" size={18} color={theme.inkFaint} />}
            trailing={<Ionicons name="eye-outline" size={18} color={theme.inkFaint} />}
          />
        </View>

        {error ? (
          <Text
            style={{
              marginTop: 12,
              fontFamily: 'Inter_500Medium',
              fontSize: 13,
              color: '#E11D48',
            }}
          >
            {error}
          </Text>
        ) : null}

        <View style={{ height: 14 }} />
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Pressable
            onPress={() => setKeep((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: keep }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
          >
            <View
              style={{
                width: 18,
                height: 18,
                borderRadius: 5,
                backgroundColor: keep ? theme.accent : 'transparent',
                borderWidth: keep ? 0 : 1,
                borderColor: theme.line,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {keep ? <Ionicons name="checkmark" size={12} color={theme.accentInk} /> : null}
            </View>
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: theme.inkSoft }}>
              Keep me signed in
            </Text>
          </Pressable>
          <Pressable onPress={onForgot}>
            <Text
              style={{
                fontFamily: 'Inter_600SemiBold',
                fontSize: 13,
                color: theme.accent,
              }}
            >
              Forgot?
            </Text>
          </Pressable>
        </View>

        <View style={{ height: 22 }} />
        <Button
          label={loading ? 'Signing in…' : 'Sign in'}
          variant="primary"
          full
          disabled={loading}
          onPress={() => onSubmit?.(email, password, keep)}
        />

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            marginTop: 22,
            marginBottom: 22,
          }}
        >
          <View style={{ flex: 1, height: 1, backgroundColor: theme.line }} />
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: theme.inkFaint }}>
            or continue with
          </Text>
          <View style={{ flex: 1, height: 1, backgroundColor: theme.line }} />
        </View>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          {[
            ...(showApple ? [{ l: 'Apple', onPress: onApple }] : []),
            { l: 'Google', onPress: onGoogle },
            { l: 'SSO', onPress: onSSO },
          ].map((opt) => (
            <Pressable
              key={opt.l}
              onPress={opt.onPress}
              style={{
                flex: 1,
                height: 48,
                borderRadius: 12,
                backgroundColor: theme.surface,
                borderWidth: 1,
                borderColor: theme.line,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 14, color: theme.ink }}>
                {opt.l}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={{ flex: 1 }} />
        <Pressable onPress={onCreateAccount} style={{ marginTop: 24 }}>
          <Text
            style={{
              textAlign: 'center',
              fontFamily: 'Inter_400Regular',
              fontSize: 13,
              color: theme.inkSoft,
            }}
          >
            New here?{' '}
            <Text style={{ color: theme.ink, fontFamily: 'Inter_600SemiBold' }}>
              Create an account
            </Text>
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

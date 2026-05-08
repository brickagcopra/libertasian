import { Pressable, Text, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
import { Photo } from '@/components/ui/Photo';
import { useTheme } from '@/providers/theme-provider';

export interface OnboardingScreenProps {
  onGetStarted?: () => void;
  onSignIn?: () => void;
  /** 0-based index of the currently active dot (3 dots total). */
  pageIndex?: number;
  pageCount?: number;
}

export function OnboardingScreen({
  onGetStarted,
  onSignIn,
  pageIndex = 0,
  pageCount = 3,
}: OnboardingScreenProps) {
  const { theme } = useTheme();

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.bg,
        paddingTop: 64,
        paddingBottom: 36,
        paddingHorizontal: 22,
      }}
    >
      <Logo />
      <View style={{ flex: 1 }} />
      <Photo
        height={300}
        radius={28}
        tone="warm"
        label="hero photo · scales of justice, soft light"
      />
      <View style={{ height: 28 }} />
      <Text
        style={{
          fontFamily: theme.serif,
          fontSize: 40,
          lineHeight: 40.8,
          letterSpacing: -1.4,
          color: theme.ink,
        }}
      >
        Law you can{' '}
        <Text style={{ fontStyle: 'italic', color: theme.accent }}>actually</Text>{' '}
        read.
      </Text>
      <Text
        style={{
          marginTop: 14,
          fontFamily: 'Inter_400Regular',
          fontSize: 15,
          lineHeight: 22.5,
          color: theme.inkSoft,
          maxWidth: 320,
        }}
      >
        Plain-language briefs, case digests, and study notes — built for human attention spans.
      </Text>
      <View style={{ height: 28 }} />
      <Button label="Get started" variant="primary" full onPress={onGetStarted} />
      <View style={{ height: 4 }} />
      <Pressable onPress={onSignIn} style={{ paddingVertical: 12 }} accessibilityRole="link">
        <Text
          style={{
            fontFamily: 'Inter_400Regular',
            fontSize: 14,
            color: theme.inkSoft,
            textAlign: 'center',
          }}
        >
          I already have an account
        </Text>
      </Pressable>
      <View style={{ height: 18 }} />
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {Array.from({ length: pageCount }).map((_, i) => {
          const active = i === pageIndex;
          return (
            <View
              key={i}
              style={{
                width: active ? 22 : 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: active ? theme.ink : theme.line,
              }}
            />
          );
        })}
      </View>
    </View>
  );
}

import type { ComponentProps } from 'react';
import { Platform, Pressable } from 'react-native';
import { router, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

type StackScreenOptions = Exclude<
  NonNullable<ComponentProps<typeof Stack>['screenOptions']>,
  (...args: never[]) => unknown
>;

/**
 * The root layout renders a <Slot />, so pushing into a route group mounts
 * that group's Stack with a single entry — the native back button never
 * renders on the group's first screen even though router.back() can pop the
 * global history. This fallback fills that gap; it stays null whenever the
 * native back button is available (headerBackVisible shows it alongside).
 */
function GroupEntryBackButton({ canGoBack }: { canGoBack?: boolean }) {
  if (canGoBack || !router.canGoBack()) return null;
  return (
    <Pressable
      onPress={() => router.back()}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Go back"
      style={{ marginRight: 16 }}
    >
      <Ionicons
        name={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'}
        size={24}
        color="#1C1A14"
      />
    </Pressable>
  );
}

/**
 * Shared native-stack header theme for every route group.
 * Colors mirror Theme A ("Warm Editorial") in src/lib/design-tokens.ts —
 * native headers are configured statically, so they can't react to the
 * theme provider.
 */
export const sharedStackScreenOptions: StackScreenOptions & {
  /** Removed in @react-navigation/native-stack v7; kept for older react-native-screens compat. */
  headerBackTitleVisible?: boolean;
} = {
  headerStyle: { backgroundColor: '#F6F1E8' },
  headerTintColor: '#1C1A14',
  headerTitleStyle: { fontFamily: 'Inter_600SemiBold', fontSize: 17 },
  headerShadowVisible: false,
  headerBackButtonDisplayMode: 'minimal',
  headerBackTitleVisible: false,
  headerBackVisible: true,
  headerLeft: (props) => <GroupEntryBackButton canGoBack={props.canGoBack} />,
};

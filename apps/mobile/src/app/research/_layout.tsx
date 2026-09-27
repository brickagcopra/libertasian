import { Stack } from 'expo-router';

import { sharedStackScreenOptions } from '@/components/navigation/stack-screen-options';

/**
 * Deep Research is a stack pushed over the tabs, not a ninth TabBar pill.
 *
 * `sharedStackScreenOptions` is load-bearing: under the root <Slot />, a group's
 * entry screen gets no native back chevron (PR #285). Each screen wraps itself
 * in <SurfaceGuard>, so the guard sits OUTSIDE every query either one fires.
 */
export default function ResearchLayout() {
  return (
    <Stack screenOptions={sharedStackScreenOptions}>
      <Stack.Screen name="index" options={{ title: 'Deep Research' }} />
      <Stack.Screen name="[id]" options={{ title: 'Research' }} />
    </Stack>
  );
}

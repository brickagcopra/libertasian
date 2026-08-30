import { Stack } from 'expo-router';

import { sharedStackScreenOptions } from '@/components/navigation/stack-screen-options';

/**
 * The purchase surface's own stack.
 *
 * Terms and Privacy are screens in THIS stack rather than external links. The
 * store guidelines require both to be reachable from the purchase surface;
 * putting them behind `Linking.openURL` would put an off-app destination on the
 * one screen Guideline 3.1.1 says must not offer one.
 */
export default function PurchaseLayout() {
  return (
    <Stack screenOptions={sharedStackScreenOptions}>
      <Stack.Screen name="index" options={{ title: 'Plans' }} />
      <Stack.Screen name="terms" options={{ title: 'Terms of Use' }} />
      <Stack.Screen name="privacy" options={{ title: 'Privacy Policy' }} />
    </Stack>
  );
}

import { Stack } from 'expo-router';
import { sharedStackScreenOptions } from '@/components/navigation/stack-screen-options';

export default function BillingLayout() {
  return (
    // Deep-link bounce screens (auto-redirect after checkout); headers would
    // only flash during the 2.5s hand-off, so both stay headerless.
    <Stack screenOptions={{ ...sharedStackScreenOptions, headerShown: false }} />
  );
}

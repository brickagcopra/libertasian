import { Stack } from 'expo-router';
import { sharedStackScreenOptions } from '@/components/navigation/stack-screen-options';

export default function SharedLayout() {
  return (
    <Stack screenOptions={sharedStackScreenOptions}>
      <Stack.Screen name="[token]" options={{ title: 'Shared Content' }} />
      <Stack.Screen name="derivative/[id]" options={{ title: 'Shared Content' }} />
    </Stack>
  );
}

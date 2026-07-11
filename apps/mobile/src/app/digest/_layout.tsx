import { Stack } from 'expo-router';
import { sharedStackScreenOptions } from '@/components/navigation/stack-screen-options';

export default function DigestLayout() {
  return (
    <Stack screenOptions={sharedStackScreenOptions}>
      {/* DigestDetailScreen renders its own header (back, share, audio player). */}
      <Stack.Screen name="[id]" options={{ headerShown: false }} />
    </Stack>
  );
}

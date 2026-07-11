import { Stack } from 'expo-router';
import { sharedStackScreenOptions } from '@/components/navigation/stack-screen-options';

export default function ReaderLayout() {
  return (
    <Stack screenOptions={sharedStackScreenOptions}>
      {/* DocumentReaderScreen renders its own header (back, bookmark, digest actions). */}
      <Stack.Screen name="[id]" options={{ headerShown: false }} />
    </Stack>
  );
}

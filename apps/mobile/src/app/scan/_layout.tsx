import { Stack } from 'expo-router';
import { sharedStackScreenOptions } from '@/components/navigation/stack-screen-options';

export default function ScanLayout() {
  return (
    <Stack screenOptions={sharedStackScreenOptions}>
      {/* Full-screen camera; a native header would break capture immersion. */}
      <Stack.Screen name="capture" options={{ headerShown: false }} />
      {/* Custom header: its back button disables while an upload is in flight. */}
      <Stack.Screen name="upload" options={{ headerShown: false }} />
      <Stack.Screen name="result/[id]" options={{ title: 'Scan Result' }} />
    </Stack>
  );
}

import { Stack } from 'expo-router';
import { sharedStackScreenOptions } from '@/components/navigation/stack-screen-options';

export default function DocumentsLayout() {
  return (
    <Stack screenOptions={sharedStackScreenOptions}>
      {/* LibraryScreen renders its own large serif title, so the native header stays blank. */}
      <Stack.Screen name="index" options={{ title: 'Documents', headerTitle: '' }} />
    </Stack>
  );
}

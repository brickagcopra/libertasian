import { Stack } from 'expo-router';
import { sharedStackScreenOptions } from '@/components/navigation/stack-screen-options';

export default function LibraryLayout() {
  return (
    <Stack screenOptions={{ ...sharedStackScreenOptions, headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen
        name="[type]/index"
        options={{ headerShown: true, title: 'Library' }}
      />
      <Stack.Screen
        name="[type]/[subject]/index"
        options={{ headerShown: true, title: 'Library' }}
      />
      <Stack.Screen
        name="[type]/[subject]/[id]"
        options={{ headerShown: true, title: 'Content' }}
      />
    </Stack>
  );
}

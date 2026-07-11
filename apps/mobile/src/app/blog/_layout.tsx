import { Stack } from 'expo-router';
import { sharedStackScreenOptions } from '@/components/navigation/stack-screen-options';

export default function BlogLayout() {
  return (
    <Stack screenOptions={sharedStackScreenOptions}>
      <Stack.Screen name="index" options={{ title: 'Blog' }} />
      <Stack.Screen name="[slug]" options={{ title: 'Blog' }} />
    </Stack>
  );
}

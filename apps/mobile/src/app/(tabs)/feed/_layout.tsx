import { Stack } from 'expo-router';
import { sharedStackScreenOptions } from '@/components/navigation/stack-screen-options';

export default function FeedLayout() {
  return (
    <Stack screenOptions={{ ...sharedStackScreenOptions, headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="organization" />
      <Stack.Screen name="bookmarks" />
      <Stack.Screen
        name="create"
        options={{
          headerShown: true,
          title: 'Create Post',
          presentation: 'modal',
        }}
      />
      <Stack.Screen
        name="[postId]"
        options={{
          headerShown: true,
          title: 'Post',
        }}
      />
    </Stack>
  );
}

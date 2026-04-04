import { Stack } from 'expo-router';

export default function FeedLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="organization" />
      <Stack.Screen name="bookmarks" />
      <Stack.Screen
        name="create"
        options={{
          headerShown: true,
          title: 'Create Post',
          presentation: 'modal',
          headerStyle: { backgroundColor: '#fff' },
          headerTitleStyle: { fontSize: 17, fontWeight: '600', color: '#111827' },
        }}
      />
      <Stack.Screen
        name="[postId]"
        options={{
          headerShown: true,
          title: 'Post',
          headerStyle: { backgroundColor: '#fff' },
          headerTitleStyle: { fontSize: 17, fontWeight: '600', color: '#111827' },
        }}
      />
    </Stack>
  );
}

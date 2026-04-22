import { Stack } from 'expo-router';

export default function LibraryLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen
        name="[type]/index"
        options={{
          headerShown: true,
          title: 'Library',
          headerStyle: { backgroundColor: '#fff' },
          headerTitleStyle: { fontSize: 17, fontWeight: '600', color: '#111827' },
        }}
      />
      <Stack.Screen
        name="[type]/[subject]/index"
        options={{
          headerShown: true,
          title: 'Library',
          headerStyle: { backgroundColor: '#fff' },
          headerTitleStyle: { fontSize: 17, fontWeight: '600', color: '#111827' },
        }}
      />
      <Stack.Screen
        name="[type]/[subject]/[id]"
        options={{
          headerShown: true,
          title: 'Content',
          headerStyle: { backgroundColor: '#fff' },
          headerTitleStyle: { fontSize: 17, fontWeight: '600', color: '#111827' },
        }}
      />
    </Stack>
  );
}

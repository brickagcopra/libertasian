import { Stack } from 'expo-router';

export default function CommunityLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#fff' },
        headerTitleStyle: { fontSize: 17, fontWeight: '600', color: '#111827' },
        headerBackTitleVisible: false,
        headerTintColor: '#1a56db',
      }}
    />
  );
}

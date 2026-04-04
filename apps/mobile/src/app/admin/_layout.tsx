import { Stack } from 'expo-router';

export default function AdminLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#fff' },
        headerTitleStyle: { fontSize: 17, fontWeight: '600', color: '#111827' },
        headerShadowVisible: false,
        headerBackTitle: 'Back',
      }}
    />
  );
}

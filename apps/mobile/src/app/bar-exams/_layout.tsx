import { Stack } from 'expo-router';

export default function BarExamsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#fff' },
        headerTitleStyle: { fontSize: 17, fontWeight: '600', color: '#111827' },
        headerTintColor: '#1a56db',
        headerShadowVisible: false,
        headerBackTitle: 'Back',
      }}
    />
  );
}

import { Stack } from 'expo-router';
import { sharedStackScreenOptions } from '@/components/navigation/stack-screen-options';

export default function SettingsLayout() {
  return (
    <Stack screenOptions={sharedStackScreenOptions}>
      {/* ProfileScreen renders its own large serif title, so the native header stays blank. */}
      <Stack.Screen name="index" options={{ title: 'Settings', headerTitle: '' }} />
      <Stack.Screen name="security" options={{ title: 'Security' }} />
      <Stack.Screen name="usage" options={{ title: 'Usage' }} />
      <Stack.Screen name="api-keys" options={{ title: 'API Keys' }} />
      <Stack.Screen name="blocked-users" options={{ title: 'Blocked users' }} />
      <Stack.Screen name="delete-account" options={{ title: 'Delete account' }} />
    </Stack>
  );
}

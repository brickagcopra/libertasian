import { Stack } from 'expo-router';
import { sharedStackScreenOptions } from '@/components/navigation/stack-screen-options';

export default function CommunityLayout() {
  return <Stack screenOptions={sharedStackScreenOptions} />;
}

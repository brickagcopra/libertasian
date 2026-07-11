import { Stack } from 'expo-router';
import { sharedStackScreenOptions } from '@/components/navigation/stack-screen-options';

export default function BarExamsLayout() {
  return <Stack screenOptions={sharedStackScreenOptions} />;
}

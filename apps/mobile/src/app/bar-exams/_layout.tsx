import { Stack } from 'expo-router';
import { SurfaceGuard } from '@/features/entitlements/surface-guard';
import { sharedStackScreenOptions } from '@/components/navigation/stack-screen-options';

export default function BarExamsLayout() {
  // Guards the whole /bar-exams subtree, not just its index: a deep link to
  // /bar-exams/2019/civil-law reaches a year page without passing the banner.
  return (
    <SurfaceGuard surface="barExams">
      <Stack screenOptions={sharedStackScreenOptions} />
    </SurfaceGuard>
  );
}

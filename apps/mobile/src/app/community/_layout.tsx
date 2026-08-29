import { Stack } from 'expo-router';
import { SurfaceGuard } from '@/features/entitlements/surface-guard';
import { sharedStackScreenOptions } from '@/components/navigation/stack-screen-options';

export default function CommunityLayout() {
  // Community shares study artifacts — flashcard sets, reviewer packs,
  // digests — so it belongs to the same surface as /study and links straight
  // into it. Its only entry point is the Study tab, which is already hidden,
  // but deep links, push notifications and a restored navigation state all
  // reach these routes without passing an entry point.
  return (
    <SurfaceGuard surface="study">
      <Stack screenOptions={sharedStackScreenOptions} />
    </SurfaceGuard>
  );
}

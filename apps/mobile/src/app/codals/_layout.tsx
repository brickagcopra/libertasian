import { Stack } from 'expo-router';
import { sharedStackScreenOptions } from '@/components/navigation/stack-screen-options';

/**
 * The codal reader sits OUTSIDE `/study` and carries no `SurfaceGuard`.
 *
 * Statutory codals are the one corpus the free tier can read — the API's
 * `case 'free'` entitlement resolution serves them to everyone, and only
 * Supreme Court decisions and bar exam questions are withheld. These two
 * routes lived under `app/study/` and so inherited the study guard, which
 * redirected a free account away from the only thing it was entitled to.
 *
 * Nothing else moved: flashcards, reviewer packs and the syllabus are paid
 * study artifacts and stay behind `app/study/_layout.tsx`.
 */
export default function CodalsLayout() {
  return (
    <Stack screenOptions={sharedStackScreenOptions}>
      <Stack.Screen name="index" options={{ title: 'Codal Reader' }} />
      <Stack.Screen name="[subject]" options={{ title: 'Codal' }} />
    </Stack>
  );
}

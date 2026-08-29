import { Stack } from 'expo-router';
import { SurfaceGuard } from '@/features/entitlements/surface-guard';
import { sharedStackScreenOptions } from '@/components/navigation/stack-screen-options';

export default function WorkspaceLayout() {
  // Guards the whole /workspace subtree. Every matter, memo, pleading,
  // comparison, timeline and task below is its own deep-linkable route, and
  // the free tier's quota for all of them is 0 — so each one loads and then
  // refuses. Hiding the tab removes the way in; this removes the rest.
  return (
    <SurfaceGuard surface="workspace">
      <Stack screenOptions={sharedStackScreenOptions} />
    </SurfaceGuard>
  );
}

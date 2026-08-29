import { Stack } from 'expo-router';
import { SurfaceGuard } from '@/features/entitlements/surface-guard';
import { sharedStackScreenOptions } from '@/components/navigation/stack-screen-options';

export default function ScanLayout() {
  // Guards the whole /scan subtree: /scan/capture and /scan/result/[id] are
  // reachable from a push notification about a finished upload, not only
  // from the FAB the Library screen now hides.
  return (
    <SurfaceGuard surface="scan">
      <Stack screenOptions={sharedStackScreenOptions}>
        {/* Full-screen camera; a native header would break capture immersion. */}
        <Stack.Screen name="capture" options={{ headerShown: false }} />
        {/* Custom header: its back button disables while an upload is in flight. */}
        <Stack.Screen name="upload" options={{ headerShown: false }} />
        <Stack.Screen name="result/[id]" options={{ title: 'Scan Result' }} />
      </Stack>
    </SurfaceGuard>
  );
}

import { lazy, Suspense, useMemo } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { useTheme } from '@/providers/theme-provider';
import { SurfaceGuard } from '@/features/entitlements/surface-guard';
import { NEW_RUN_ID } from '@/features/deep-research/navigation';
import type { RunViewProps } from '@/features/deep-research/components/run-view';

// Lazy: the stepper, the result renderer and the citation sheet are only
// evaluated when a run is actually opened. A deferred `require` rather than
// `import()`: the app's tsconfig module target rejects dynamic import (TS1323),
// and Metro evaluates a module on its first `require`, so deferring the call is
// what defers the work. Typed through `typeof import`, never `any`.
type RunViewModule = typeof import('@/features/deep-research/components/run-view');
const RunView = lazy(() =>
  Promise.resolve(require('@/features/deep-research/components/run-view') as RunViewModule),
);

const styles = StyleSheet.create({
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/**
 * `/research/new?q=…&t=…` streams a new run; `/research/<uuid>` opens a past
 * one. `t` is a one-shot token so a remount never starts (and pays for) a
 * second run.
 */
export default function ResearchRunRoute() {
  const { theme } = useTheme();
  const params = useLocalSearchParams<{ id?: string; q?: string; t?: string }>();
  const id = first(params.id);
  const question = first(params.q);
  const token = first(params.t);

  const props = useMemo<RunViewProps>(
    () =>
      id === NEW_RUN_ID
        ? { mode: 'live', question, token: token || `${question}:${id}` }
        : { mode: 'past', id },
    [id, question, token],
  );

  return (
    <SurfaceGuard surface="workspace" entryPoint="deepResearch">
      <Suspense
        fallback={
          <View style={[styles.fallback, { backgroundColor: theme.bg }]}>
            <ActivityIndicator color={theme.accent} />
          </View>
        }
      >
        <RunView {...props} />
      </Suspense>
    </SurfaceGuard>
  );
}

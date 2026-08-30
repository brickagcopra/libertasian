import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { useTheme } from '@/providers/theme-provider';

import { PURCHASE_ROUTE } from '../routes';

/** What each guarded surface is, in one line, with no tier or price. */
const SURFACE_BLURB: Record<string, string> = {
  scan: 'Scan a document with your camera and get a structured digest back.',
  study: 'Flashcards, reviewer packs and study sessions built from the corpus.',
  barExams: 'Past bar examination questions, with model answers.',
  digestGeneration: 'Turn any document into a structured case digest.',
  workspace: 'Matters, notes, memos, pleadings, comparisons and timelines.',
};

export interface PurchaseEntryPointProps {
  /** Which surface the user tried to open. */
  surface: string;
}

/**
 * Rendered IN PLACE OF a guarded surface's paid content when the account is not
 * entitled but a store purchase is available on this platform (D14, option B
 * via mechanism C).
 *
 * WHY THIS REPLACES THE CONTENT RATHER THAN SITTING BESIDE IT. The screen's
 * data-fetching subtree never mounts, so it fires no request the API would
 * refuse. That is the property Guideline 3.1.1 actually cares about — build 23
 * was rejected for showing a feature and then refusing it, and a screen that
 * loads its paid content and then errors is that pattern with extra steps.
 * Here the user is shown WHAT the surface is and a way to get it, which is the
 * ordinary, approvable shape for a subscription app.
 *
 * It names no plan and no price. Both live on the purchase screen one tap away,
 * where they come from the store's own localized offering — this component is
 * reached from `SurfaceGuard`, which is outside the purchase surface, so it
 * must survive the FORBIDDEN word list even though it lives inside it.
 */
export function PurchaseEntryPoint({ surface }: PurchaseEntryPointProps) {
  const { theme } = useTheme();
  const blurb = SURFACE_BLURB[surface];

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.bg,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 28,
      }}
    >
      {blurb ? (
        <Text
          style={{
            fontFamily: theme.sans,
            fontSize: 16,
            lineHeight: 24,
            color: theme.inkSoft,
            textAlign: 'center',
            marginBottom: 24,
          }}
        >
          {blurb}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        testID="purchase-entry-point"
        onPress={() => router.push(PURCHASE_ROUTE)}
        style={{
          borderRadius: theme.radius,
          backgroundColor: theme.accent,
          paddingVertical: 14,
          paddingHorizontal: 28,
        }}
      >
        <Text
          style={{
            fontFamily: theme.sans,
            fontSize: 16,
            fontWeight: '600',
            color: theme.accentInk,
          }}
        >
          See options
        </Text>
      </Pressable>
    </View>
  );
}

import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { useTheme } from '@/providers/theme-provider';

import type { PurchasePlanOption, StoreProductId } from '../products';
import { PlanCard } from './plan-card';

/**
 * What the surface is currently able to do.
 *
 * `unavailable` covers every reason the store could not hand us options — no
 * network, no products configured yet, a store account signed out. They are one
 * state on purpose: the user's next action is identical in all of them, and
 * enumerating store-side failure modes on a purchase screen invites copy that
 * explains how to subscribe some other way.
 */
export type PurchaseSurfaceStatus = 'loading' | 'ready' | 'unavailable';

export interface PurchaseSurfaceProps {
  status: PurchaseSurfaceStatus;
  /** Store-supplied options. Empty unless `status === 'ready'`. */
  plans: PurchasePlanOption[];
  /** In flight: a purchase or a restore. Disables both actions. */
  busy?: boolean;
  /**
   * A neutral line under the actions. Used for "we could not confirm that yet"
   * — never for a price, a plan name, or a way to subscribe elsewhere.
   */
  notice?: string | null;
  onPurchase: (productId: StoreProductId) => void;
  onRestore: () => void;
  onOpenTerms: () => void;
  onOpenPrivacy: () => void;
}

/**
 * The one screen in this app permitted to name a purchasable thing.
 *
 * Everything else in `src/` is held to `no-purchase-copy.test.ts`'s FORBIDDEN
 * list; this tree is exempted BY LOCATION (`features/purchase/`), and that
 * exemption is itself asserted — a matching test scans all of `src/` with no
 * skipping and fails if a purchase-implying string appears outside here.
 *
 * WHAT THIS FILE MUST NEVER CONTAIN, in any future edit:
 *
 *  - a price, a currency symbol, or a period string. Every one of those arrives
 *    on `plans` from the store's localized offering.
 *  - a URL, a `Linking.openURL`, or any mention of the website, web pricing or
 *    an off-app way to subscribe. Guideline 3.1.1 — this is what got build 23
 *    rejected, and the Terms and Privacy links below go to IN-APP screens for
 *    exactly that reason.
 */
export function PurchaseSurface({
  status,
  plans,
  busy = false,
  notice,
  onPurchase,
  onRestore,
  onOpenTerms,
  onOpenPrivacy,
}: PurchaseSurfaceProps) {
  const { theme } = useTheme();
  const [selected, setSelected] = useState<StoreProductId | null>(null);

  const activeId = selected ?? plans[0]?.productId ?? null;
  const canPurchase = status === 'ready' && activeId !== null && !busy;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
    >
      <Text
        style={{
          fontFamily: theme.serif,
          fontSize: 28,
          color: theme.ink,
          marginBottom: 6,
        }}
      >
        Choose a plan
      </Text>
      <Text
        style={{
          fontFamily: theme.sans,
          fontSize: 15,
          color: theme.inkSoft,
          marginBottom: 20,
        }}
      >
        Full access to research, digests, scanning and your workspace.
      </Text>

      {status === 'loading' ? (
        <View style={{ paddingVertical: 32, alignItems: 'center' }}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : null}

      {status === 'unavailable' ? (
        <View
          style={{
            borderRadius: theme.radius,
            backgroundColor: theme.surfaceMuted,
            padding: 16,
            marginBottom: 20,
          }}
        >
          <Text
            style={{ fontFamily: theme.sans, fontSize: 15, color: theme.inkSoft }}
          >
            Plans are not available right now. Please try again later.
          </Text>
        </View>
      ) : null}

      {status === 'ready'
        ? plans.map((plan) => (
            <PlanCard
              key={plan.productId}
              plan={plan}
              selected={plan.productId === activeId}
              disabled={busy}
              onSelect={setSelected}
            />
          ))
        : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !canPurchase }}
        disabled={!canPurchase}
        onPress={() => {
          if (activeId) onPurchase(activeId);
        }}
        style={{
          borderRadius: theme.radius,
          backgroundColor: theme.accent,
          paddingVertical: 16,
          alignItems: 'center',
          marginTop: 8,
          opacity: canPurchase ? 1 : 0.5,
        }}
      >
        {busy ? (
          <ActivityIndicator color={theme.accentInk} />
        ) : (
          <Text
            style={{
              fontFamily: theme.sans,
              fontSize: 16,
              fontWeight: '600',
              color: theme.accentInk,
            }}
          >
            Continue
          </Text>
        )}
      </Pressable>

      {/*
        Guideline 3.1.1 requires a restore mechanism for any restorable in-app
        purchase, and it must be reachable from an account that currently holds
        nothing — which is exactly the state a restoring user is in, and the
        state App Review tests it from. So it is always visible here, never
        conditional on having something to restore.
      */}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={onRestore}
        style={{ paddingVertical: 14, alignItems: 'center', marginTop: 4 }}
      >
        <Text
          style={{
            fontFamily: theme.sans,
            fontSize: 15,
            color: theme.ink,
            textDecorationLine: 'underline',
            opacity: busy ? 0.5 : 1,
          }}
        >
          Restore Purchases
        </Text>
      </Pressable>

      {notice ? (
        <Text
          style={{
            fontFamily: theme.sans,
            fontSize: 14,
            color: theme.inkSoft,
            textAlign: 'center',
            marginTop: 8,
          }}
        >
          {notice}
        </Text>
      ) : null}

      {/*
        In-app screens, not URLs. Guideline 3.1.2 requires functional links to
        the terms and the privacy policy from the purchase surface; sending the
        user to a browser would put an off-app destination on the one screen
        3.1.1 says must not have one.
      */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'center',
          gap: 24,
          marginTop: 28,
        }}
      >
        <Pressable accessibilityRole="button" onPress={onOpenTerms}>
          <Text
            style={{ fontFamily: theme.sans, fontSize: 13, color: theme.inkFaint }}
          >
            Terms of Use
          </Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onOpenPrivacy}>
          <Text
            style={{ fontFamily: theme.sans, fontSize: 13, color: theme.inkFaint }}
          >
            Privacy Policy
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

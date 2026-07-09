import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Modal,
  RefreshControl,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/providers/theme-provider';
import { usePlanInfoList, useActivePromotions } from '../../features/billing/hooks/use-plans';
import { useSubscription } from '../../features/billing/hooks/use-subscription';
import { useCreateCheckout, useCheckoutPreview } from '../../features/billing/hooks/use-billing';
import {
  formatPHP,
  getPromotionDiscountLabel,
  TIER_ORDER,
} from '../../features/billing/types';
import type { PlanInfo, CheckoutPreviewData } from '../../features/billing/types';

// Xendit rejects custom-scheme redirect URLs (the API DTO enforces @IsUrl),
// so checkout bounces through public web pages that hand back to the app
// via the libertasian:// scheme. See apps/web/src/app/billing/mobile/*.
const CHECKOUT_SUCCESS_URL = 'https://libertasian.com/billing/mobile/success';
const CHECKOUT_CANCEL_URL = 'https://libertasian.com/billing/mobile/cancel';

export default function PlansScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { plans, isLoading: plansLoading } = usePlanInfoList();
  const { data: subscription, isLoading: subLoading } = useSubscription();
  const { data: promotions } = useActivePromotions();
  const checkoutPreview = useCheckoutPreview();
  const createCheckout = useCreateCheckout();

  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly');
  const [previewData, setPreviewData] = useState<CheckoutPreviewData | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);

  const isLoading = plansLoading || subLoading;
  const currentPlanCode = subscription?.planCode ?? 'free';
  const currentTierIdx = TIER_ORDER.indexOf(currentPlanCode);

  // Entitlement safety net: checkout finishes in the system browser, so the
  // deep link back may never fire. Refresh billing data whenever the app
  // returns to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        queryClient.invalidateQueries({ queryKey: ['billing'] });
      }
    });
    return () => sub.remove();
  }, [queryClient]);

  function getActionLabel(planCode: string): string | null {
    if (planCode === 'free') return null;
    if (planCode === currentPlanCode) return 'Current Plan';
    const targetIdx = TIER_ORDER.indexOf(planCode);
    if (targetIdx > currentTierIdx) return 'Upgrade';
    return 'Downgrade';
  }

  function handleBack() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/settings');
    }
  }

  async function handleSelectPlan(plan: PlanInfo) {
    if (plan.code === currentPlanCode || plan.code === 'free') return;

    setSelectedPlan(plan.code);

    try {
      const preview = await checkoutPreview.mutateAsync({
        planCode: plan.code as 'edu' | 'pro' | 'team' | 'enterprise',
        billingPeriod,
      });
      setPreviewData(preview);
    } catch (error) {
      // Preview failed — proceed to checkout directly
      handleCheckout(plan.code);
    }
  }

  async function handleCheckout(planCode: string) {
    try {
      const result = await createCheckout.mutateAsync({
        planCode: planCode as 'edu' | 'pro' | 'team' | 'enterprise',
        billingPeriod,
        successUrl: CHECKOUT_SUCCESS_URL,
        cancelUrl: CHECKOUT_CANCEL_URL,
      });

      if (result.checkoutUrl) {
        // Open in system browser (not in-app webview) so user can verify
        // they're on the real xendit.co domain for payment security
        await Linking.openURL(result.checkoutUrl);
      }
    } catch (error) {
      Alert.alert(
        'Checkout Error',
        error instanceof Error ? error.message : 'Failed to create checkout session',
      );
    } finally {
      setSelectedPlan(null);
      setPreviewData(null);
    }
  }

  function dismissPreview() {
    setSelectedPlan(null);
    setPreviewData(null);
  }

  const promoLabelForPeriod = promotions?.[0]
    ? getPromotionDiscountLabel(promotions[0], billingPeriod)
    : null;

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={[styles.backPill, { backgroundColor: theme.pillBg }]}
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={18} color={theme.pillInk} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { fontFamily: theme.serif, color: theme.ink }]}>
          Plans
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={() => queryClient.invalidateQueries({ queryKey: ['billing'] })}
            colors={[theme.ink]}
            tintColor={theme.ink}
          />
        }
      >
        {/* Billing Period Toggle */}
        <View style={[styles.toggleContainer, { backgroundColor: theme.chipBg }]}>
          <TouchableOpacity
            style={[
              styles.toggleButton,
              billingPeriod === 'monthly' && { backgroundColor: theme.pillBg },
            ]}
            onPress={() => setBillingPeriod('monthly')}
          >
            <Text
              style={[
                styles.toggleText,
                { color: billingPeriod === 'monthly' ? theme.pillInk : theme.inkSoft },
              ]}
            >
              Monthly
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.toggleButton,
              billingPeriod === 'annual' && { backgroundColor: theme.pillBg },
            ]}
            onPress={() => setBillingPeriod('annual')}
          >
            <Text
              style={[
                styles.toggleText,
                { color: billingPeriod === 'annual' ? theme.pillInk : theme.inkSoft },
              ]}
            >
              Annual
            </Text>
            <View style={[styles.saveBadge, { backgroundColor: theme.accentSoft }]}>
              <Text style={[styles.saveBadgeText, { color: theme.ink }]}>Save ~17%</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Active Promotions Banner */}
        {promotions && promotions.length > 0 && (
          <View style={[styles.promoBanner, { backgroundColor: theme.accentSoft }]}>
            <Ionicons name="gift-outline" size={18} color={theme.accent} />
            <Text style={[styles.promoText, { color: theme.ink }]}>
              {promotions[0].name}
              {promotions[0].description ? ` — ${promotions[0].description}` : ''}
            </Text>
          </View>
        )}

        {isLoading ? (
          <ActivityIndicator color={theme.ink} style={styles.loader} />
        ) : (
          plans.map((plan) => {
            const actionLabel = getActionLabel(plan.code);
            const isCurrent = plan.code === currentPlanCode;
            const isHighlight = plan.highlight === true;
            const cardInk = isHighlight ? theme.pillInk : theme.ink;
            const cardInkSoft = isHighlight ? theme.pillInk : theme.inkSoft;
            const price =
              billingPeriod === 'monthly' ? plan.monthlyPrice : plan.annualPrice;

            return (
              <View
                key={plan.code}
                style={[
                  styles.planCard,
                  {
                    backgroundColor: isHighlight ? theme.pillBg : theme.surface,
                    borderColor: theme.line,
                  },
                ]}
              >
                {isHighlight && (
                  <View style={[styles.popularBadge, { backgroundColor: theme.accent }]}>
                    <Text style={[styles.popularBadgeText, { color: theme.accentInk }]}>
                      Most Popular
                    </Text>
                  </View>
                )}

                <View style={styles.planHeader}>
                  <Text style={[styles.planName, { fontFamily: theme.serif, color: cardInk }]}>
                    {plan.name}
                  </Text>
                  <View style={styles.priceContainer}>
                    <Text style={[styles.priceAmount, { color: cardInk }]}>
                      {price === 0 ? 'Free' : `₱${price.toLocaleString('en-PH')}`}
                    </Text>
                    {price > 0 && (
                      <Text style={[styles.pricePeriod, { color: cardInkSoft }]}>
                        /{billingPeriod === 'monthly' ? 'mo' : 'yr'}
                      </Text>
                    )}
                  </View>
                  {promoLabelForPeriod && plan.code !== 'free' && (
                    <View style={[styles.promoLabelBadge, { backgroundColor: theme.accentSoft }]}>
                      <Text style={[styles.promoLabelText, { color: theme.ink }]}>
                        {promoLabelForPeriod}
                      </Text>
                    </View>
                  )}
                </View>

                <View style={styles.featureList}>
                  {plan.features.map((feature, idx) => (
                    <View key={idx} style={styles.featureRow}>
                      <Ionicons name="checkmark-circle" size={16} color={theme.accent} />
                      <Text style={[styles.featureText, { color: cardInkSoft }]}>{feature}</Text>
                    </View>
                  ))}
                </View>

                {actionLabel && (
                  <TouchableOpacity
                    style={[
                      styles.planButton,
                      {
                        backgroundColor: isCurrent
                          ? theme.accentSoft
                          : isHighlight
                            ? theme.accent
                            : theme.pillBg,
                      },
                    ]}
                    disabled={isCurrent || selectedPlan === plan.code}
                    onPress={() => handleSelectPlan(plan)}
                  >
                    {selectedPlan === plan.code && checkoutPreview.isPending ? (
                      <ActivityIndicator
                        size="small"
                        color={isHighlight ? theme.accentInk : theme.pillInk}
                      />
                    ) : (
                      <Text
                        style={[
                          styles.planButtonText,
                          {
                            color: isCurrent
                              ? theme.ink
                              : isHighlight
                                ? theme.accentInk
                                : theme.pillInk,
                          },
                        ]}
                      >
                        {actionLabel}
                      </Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Checkout Preview — bottom sheet */}
      <Modal
        transparent
        visible={previewData !== null}
        animationType="slide"
        onRequestClose={dismissPreview}
      >
        <View style={styles.modalScrim}>
          <Pressable
            style={styles.scrimDismissArea}
            onPress={dismissPreview}
            accessibilityLabel="Dismiss checkout preview"
          />
          {previewData && (
            <View
              style={[
                styles.sheet,
                { backgroundColor: theme.surface, paddingBottom: insets.bottom + 20 },
              ]}
            >
              <View style={[styles.sheetHandle, { backgroundColor: theme.line }]} />
              <Text style={[styles.previewTitle, { fontFamily: theme.serif, color: theme.ink }]}>
                {previewData.isUpgrade
                  ? 'Upgrade'
                  : previewData.isDowngrade
                    ? 'Downgrade'
                    : 'Subscribe'}{' '}
                to {previewData.planName}
              </Text>

              <View style={styles.previewRow}>
                <Text style={[styles.previewLabel, { color: theme.inkSoft }]}>Base Price</Text>
                <Text style={[styles.previewValue, { color: theme.ink }]}>
                  {formatPHP(previewData.basePriceAmount)}
                </Text>
              </View>

              {previewData.couponDiscountAmount > 0 && (
                <View style={styles.previewRow}>
                  <Text style={[styles.previewLabel, { color: theme.inkSoft }]}>
                    Coupon ({previewData.couponCode})
                  </Text>
                  <Text style={[styles.previewValue, { color: theme.accent }]}>
                    -{formatPHP(previewData.couponDiscountAmount)}
                  </Text>
                </View>
              )}

              {previewData.promotionDiscountAmount > 0 && (
                <View style={styles.previewRow}>
                  <Text style={[styles.previewLabel, { color: theme.inkSoft }]}>Promotion</Text>
                  <Text style={[styles.previewValue, { color: theme.accent }]}>
                    -{formatPHP(previewData.promotionDiscountAmount)}
                  </Text>
                </View>
              )}

              <View style={[styles.divider, { backgroundColor: theme.line }]} />

              <View style={styles.previewRow}>
                <Text style={[styles.previewTotalLabel, { color: theme.ink }]}>Total</Text>
                <Text style={[styles.previewTotalValue, { color: theme.ink }]}>
                  {formatPHP(previewData.finalAmount)}
                </Text>
              </View>

              <View style={styles.previewActions}>
                <TouchableOpacity
                  style={[styles.previewCancelButton, { backgroundColor: theme.chipBg }]}
                  onPress={dismissPreview}
                >
                  <Text style={[styles.previewCancelText, { color: theme.inkSoft }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.previewConfirmButton, { backgroundColor: theme.pillBg }]}
                  onPress={() => handleCheckout(previewData.planCode)}
                  disabled={createCheckout.isPending}
                >
                  {createCheckout.isPending ? (
                    <ActivityIndicator size="small" color={theme.pillInk} />
                  ) : (
                    <Text style={[styles.previewConfirmText, { color: theme.pillInk }]}>
                      Proceed to Payment
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 14,
  },
  backPill: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 28, letterSpacing: -0.4 },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  loader: { marginTop: 40 },
  toggleContainer: {
    flexDirection: 'row',
    borderRadius: 999,
    padding: 4,
    marginBottom: 16,
  },
  toggleButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 999,
    gap: 6,
  },
  toggleText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  saveBadge: { borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  saveBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  promoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    padding: 12,
    marginBottom: 16,
    gap: 8,
  },
  promoText: { fontSize: 13, flex: 1, fontFamily: 'Inter_500Medium' },
  planCard: {
    borderRadius: 22,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
  },
  popularBadge: {
    position: 'absolute',
    top: -10,
    right: 16,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  popularBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold' },
  planHeader: { marginBottom: 12 },
  planName: { fontSize: 24 },
  priceContainer: { flexDirection: 'row', alignItems: 'baseline', marginTop: 4 },
  priceAmount: { fontSize: 28, fontFamily: 'Inter_700Bold' },
  pricePeriod: { fontSize: 14, marginLeft: 2, fontFamily: 'Inter_400Regular' },
  promoLabelBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
    marginTop: 6,
  },
  promoLabelText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  featureList: { marginBottom: 12 },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6, gap: 8 },
  featureText: { fontSize: 13, flex: 1, lineHeight: 18, fontFamily: 'Inter_400Regular' },
  planButton: {
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
  },
  planButtonText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  // Checkout preview bottom sheet
  modalScrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  scrimDismissArea: { flex: 1 },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 14,
  },
  previewTitle: { fontSize: 22, marginBottom: 16 },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  previewLabel: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  previewValue: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  divider: { height: 1, marginVertical: 8 },
  previewTotalLabel: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  previewTotalValue: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  previewActions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  previewCancelButton: {
    flex: 1,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
  },
  previewCancelText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  previewConfirmButton: {
    flex: 2,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
  },
  previewConfirmText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
});

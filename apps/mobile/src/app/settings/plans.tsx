import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Linking,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePlanInfoList, useActivePromotions } from '../../features/billing/hooks/use-plans';
import { useSubscription } from '../../features/billing/hooks/use-subscription';
import { useCreateCheckout, useCheckoutPreview } from '../../features/billing/hooks/use-billing';
import {
  formatPHP,
  getPromotionDiscountLabel,
  TIER_ORDER,
} from '../../features/billing/types';
import type { PlanInfo, CheckoutPreviewData } from '../../features/billing/types';

export default function PlansScreen() {
  const { plans, isLoading: plansLoading, isFromApi } = usePlanInfoList();
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

  function getActionLabel(planCode: string): string | null {
    if (planCode === 'free') return null;
    if (planCode === currentPlanCode) return 'Current Plan';
    const targetIdx = TIER_ORDER.indexOf(planCode);
    if (targetIdx > currentTierIdx) return 'Upgrade';
    return 'Downgrade';
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
        successUrl: 'libertasian://billing/success',
        cancelUrl: 'libertasian://billing/cancel',
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

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={() => {}} colors={['#1a56db']} />
      }
    >
      {/* Billing Period Toggle */}
      <View style={styles.toggleContainer}>
        <TouchableOpacity
          style={[
            styles.toggleButton,
            billingPeriod === 'monthly' && styles.toggleActive,
          ]}
          onPress={() => setBillingPeriod('monthly')}
        >
          <Text
            style={[
              styles.toggleText,
              billingPeriod === 'monthly' && styles.toggleTextActive,
            ]}
          >
            Monthly
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.toggleButton,
            billingPeriod === 'annual' && styles.toggleActive,
          ]}
          onPress={() => setBillingPeriod('annual')}
        >
          <Text
            style={[
              styles.toggleText,
              billingPeriod === 'annual' && styles.toggleTextActive,
            ]}
          >
            Annual
          </Text>
          <View style={styles.saveBadge}>
            <Text style={styles.saveBadgeText}>Save ~17%</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Active Promotions Banner */}
      {promotions && promotions.length > 0 && (
        <View style={styles.promoBanner}>
          <Ionicons name="gift-outline" size={18} color="#7c3aed" />
          <Text style={styles.promoText}>
            {promotions[0].name}
            {promotions[0].description ? ` — ${promotions[0].description}` : ''}
          </Text>
        </View>
      )}

      {isLoading ? (
        <ActivityIndicator color="#1a56db" style={styles.loader} />
      ) : (
        plans.map((plan) => {
          const actionLabel = getActionLabel(plan.code);
          const isCurrent = plan.code === currentPlanCode;
          const price =
            billingPeriod === 'monthly' ? plan.monthlyPrice : plan.annualPrice;
          const promoLabel = promotions?.[0]
            ? getPromotionDiscountLabel(promotions[0], billingPeriod)
            : null;

          return (
            <View
              key={plan.code}
              style={[
                styles.planCard,
                plan.highlight && styles.planCardHighlight,
                isCurrent && styles.planCardCurrent,
              ]}
            >
              {plan.highlight && (
                <View style={styles.popularBadge}>
                  <Text style={styles.popularBadgeText}>Most Popular</Text>
                </View>
              )}

              <View style={styles.planHeader}>
                <Text style={styles.planName}>{plan.name}</Text>
                <View style={styles.priceContainer}>
                  <Text style={styles.priceAmount}>
                    {price === 0 ? 'Free' : `\u20B1${price.toLocaleString('en-PH')}`}
                  </Text>
                  {price > 0 && (
                    <Text style={styles.pricePeriod}>
                      /{billingPeriod === 'monthly' ? 'mo' : 'yr'}
                    </Text>
                  )}
                </View>
                {promoLabel && plan.code !== 'free' && (
                  <View style={styles.promoLabelBadge}>
                    <Text style={styles.promoLabelText}>{promoLabel}</Text>
                  </View>
                )}
              </View>

              <View style={styles.featureList}>
                {plan.features.map((feature, idx) => (
                  <View key={idx} style={styles.featureRow}>
                    <Ionicons
                      name="checkmark-circle"
                      size={16}
                      color={plan.highlight ? '#1a56db' : '#16a34a'}
                    />
                    <Text style={styles.featureText}>{feature}</Text>
                  </View>
                ))}
              </View>

              {actionLabel && (
                <TouchableOpacity
                  style={[
                    styles.planButton,
                    isCurrent && styles.planButtonCurrent,
                    !isCurrent && plan.highlight && styles.planButtonHighlight,
                  ]}
                  disabled={isCurrent || selectedPlan === plan.code}
                  onPress={() => handleSelectPlan(plan)}
                >
                  {selectedPlan === plan.code && checkoutPreview.isPending ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text
                      style={[
                        styles.planButtonText,
                        isCurrent && styles.planButtonTextCurrent,
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

      {/* Checkout Preview Modal */}
      {previewData && (
        <View style={styles.previewOverlay}>
          <View style={styles.previewCard}>
            <Text style={styles.previewTitle}>
              {previewData.isUpgrade ? 'Upgrade' : previewData.isDowngrade ? 'Downgrade' : 'Subscribe'} to {previewData.planName}
            </Text>

            <View style={styles.previewRow}>
              <Text style={styles.previewLabel}>Base Price</Text>
              <Text style={styles.previewValue}>
                {formatPHP(previewData.basePriceAmount)}
              </Text>
            </View>

            {previewData.couponDiscountAmount > 0 && (
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>
                  Coupon ({previewData.couponCode})
                </Text>
                <Text style={[styles.previewValue, styles.discountText]}>
                  -{formatPHP(previewData.couponDiscountAmount)}
                </Text>
              </View>
            )}

            {previewData.promotionDiscountAmount > 0 && (
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>Promotion</Text>
                <Text style={[styles.previewValue, styles.discountText]}>
                  -{formatPHP(previewData.promotionDiscountAmount)}
                </Text>
              </View>
            )}

            <View style={styles.divider} />

            <View style={styles.previewRow}>
              <Text style={styles.previewTotalLabel}>Total</Text>
              <Text style={styles.previewTotalValue}>
                {formatPHP(previewData.finalAmount)}
              </Text>
            </View>

            <View style={styles.previewActions}>
              <TouchableOpacity
                style={styles.previewCancelButton}
                onPress={dismissPreview}
              >
                <Text style={styles.previewCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.previewConfirmButton}
                onPress={() => handleCheckout(previewData.planCode)}
                disabled={createCheckout.isPending}
              >
                {createCheckout.isPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.previewConfirmText}>Proceed to Payment</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  content: { padding: 16, paddingBottom: 40 },
  loader: { marginTop: 40 },
  toggleContainer: {
    flexDirection: 'row',
    backgroundColor: '#e5e7eb',
    borderRadius: 10,
    padding: 4,
    marginBottom: 16,
  },
  toggleButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  toggleActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  toggleText: { fontSize: 14, fontWeight: '600', color: '#6b7280' },
  toggleTextActive: { color: '#111827' },
  saveBadge: { backgroundColor: '#dcfce7', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  saveBadgeText: { fontSize: 10, fontWeight: '700', color: '#166534' },
  promoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f3ff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    gap: 8,
  },
  promoText: { fontSize: 13, color: '#7c3aed', flex: 1, fontWeight: '500' },
  planCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  planCardHighlight: { borderColor: '#1a56db', borderWidth: 2 },
  planCardCurrent: { borderColor: '#16a34a', borderWidth: 2 },
  popularBadge: {
    position: 'absolute',
    top: -10,
    right: 16,
    backgroundColor: '#1a56db',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  popularBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  planHeader: { marginBottom: 12 },
  planName: { fontSize: 20, fontWeight: '700', color: '#111827' },
  priceContainer: { flexDirection: 'row', alignItems: 'baseline', marginTop: 4 },
  priceAmount: { fontSize: 28, fontWeight: '800', color: '#111827' },
  pricePeriod: { fontSize: 14, color: '#6b7280', marginLeft: 2 },
  promoLabelBadge: {
    backgroundColor: '#f5f3ff',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
    marginTop: 6,
  },
  promoLabelText: { fontSize: 12, fontWeight: '600', color: '#7c3aed' },
  featureList: { marginBottom: 12 },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6, gap: 8 },
  featureText: { fontSize: 13, color: '#374151', flex: 1, lineHeight: 18 },
  planButton: {
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  planButtonHighlight: { backgroundColor: '#1a56db' },
  planButtonCurrent: { backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0' },
  planButtonText: { fontSize: 15, fontWeight: '600', color: '#374151' },
  planButtonTextCurrent: { color: '#16a34a' },
  // Preview overlay
  previewOverlay: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  previewCard: {},
  previewTitle: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 16 },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  previewLabel: { fontSize: 14, color: '#6b7280' },
  previewValue: { fontSize: 14, color: '#111827', fontWeight: '500' },
  discountText: { color: '#16a34a' },
  divider: { height: 1, backgroundColor: '#e5e7eb', marginVertical: 8 },
  previewTotalLabel: { fontSize: 16, fontWeight: '700', color: '#111827' },
  previewTotalValue: { fontSize: 18, fontWeight: '800', color: '#111827' },
  previewActions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  previewCancelButton: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  previewCancelText: { fontSize: 15, fontWeight: '600', color: '#6b7280' },
  previewConfirmButton: {
    flex: 2,
    backgroundColor: '#1a56db',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  previewConfirmText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});

import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/providers/theme-provider';
import { usePlanInfoList } from '../../features/billing/hooks/use-plans';
import { useSubscription } from '../../features/billing/hooks/use-subscription';

/**
 * Your plan — READ ONLY.
 *
 * This screen used to list every plan with prices and open a Xendit checkout
 * in the system browser. Apple Guideline 3.1.1 and Google Play's Payments
 * policy both forbid selling digital content through a non-store payment
 * flow, and both treat linking or steering users to an external purchase as
 * the same violation. So the mobile app does not sell at all: no prices, no
 * upgrade CTA, no coupon field, no outbound link.
 *
 * What IS allowed, and what this screen does, is show the plan the account
 * already has and what it includes. The rule is applied unconditionally
 * rather than behind a Platform.OS check — a single binary is easier to
 * reason about, and Play's policy is not meaningfully more permissive here.
 *
 * Purchasing lives on the web app, which is out of scope for this rule. The
 * app deliberately does not say so: naming where to buy is itself steering.
 */
export default function PlansScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { plans, isLoading: plansLoading } = usePlanInfoList();
  const { data: subscription, isLoading: subLoading } = useSubscription();

  const isLoading = plansLoading || subLoading;
  const currentPlanCode = subscription?.planCode ?? 'free';
  const currentPlan = plans.find((p) => p.code === currentPlanCode);

  function handleBack() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/settings');
    }
  }

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
          Your plan
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={() => queryClient.invalidateQueries({ queryKey: ['billing'] })}
            colors={[theme.ink]}
            tintColor={theme.ink}
          />
        }
      >
        {isLoading ? (
          <ActivityIndicator color={theme.ink} style={styles.loader} />
        ) : (
          <View
            style={[
              styles.planCard,
              { backgroundColor: theme.surface, borderColor: theme.line },
            ]}
          >
            <View style={styles.planHeader}>
              <View style={[styles.currentBadge, { backgroundColor: theme.accentSoft }]}>
                <Text style={[styles.currentBadgeText, { color: theme.ink }]}>
                  Current plan
                </Text>
              </View>
              <Text
                style={[styles.planName, { fontFamily: theme.serif, color: theme.ink }]}
              >
                {currentPlan?.name ?? 'Free'}
              </Text>
            </View>

            {currentPlan && currentPlan.features.length > 0 ? (
              <>
                <Text style={[styles.includedLabel, { color: theme.inkSoft }]}>
                  What&apos;s included
                </Text>
                <View style={styles.featureList}>
                  {currentPlan.features.map((feature, idx) => (
                    <View key={idx} style={styles.featureRow}>
                      <Ionicons name="checkmark-circle" size={16} color={theme.accent} />
                      <Text style={[styles.featureText, { color: theme.inkSoft }]}>
                        {feature}
                      </Text>
                    </View>
                  ))}
                </View>
              </>
            ) : (
              <Text style={[styles.featureText, { color: theme.inkSoft }]}>
                Your plan details are unavailable right now. Pull down to refresh.
              </Text>
            )}
          </View>
        )}

        <TouchableOpacity
          style={[styles.linkRow, { backgroundColor: theme.surface, borderColor: theme.line }]}
          onPress={() => router.push('/settings/subscription')}
          accessibilityRole="button"
        >
          <Ionicons name="receipt-outline" size={18} color={theme.inkSoft} />
          <Text style={[styles.linkRowText, { color: theme.ink }]}>
            Subscription details
          </Text>
          <Ionicons name="chevron-forward" size={16} color={theme.inkSoft} />
        </TouchableOpacity>
      </ScrollView>
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
  content: { padding: 16 },
  loader: { marginTop: 40 },
  planCard: {
    borderRadius: 22,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
  },
  planHeader: { marginBottom: 14, gap: 8 },
  currentBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  currentBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold' },
  planName: { fontSize: 26 },
  includedLabel: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  featureList: { marginBottom: 4 },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6, gap: 8 },
  featureText: { fontSize: 13, flex: 1, lineHeight: 18, fontFamily: 'Inter_400Regular' },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  linkRowText: { flex: 1, fontSize: 14, fontFamily: 'Inter_500Medium' },
});

import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuotaUsage } from '../../features/billing/hooks/use-quotas';
import {
  ENTITLEMENT_LABELS,
  quotaPercent,
  isNearLimit,
  isUnlimited,
} from '../../features/billing/types';
import type { QuotaUsageItem, ActiveBonus } from '../../features/billing/types';

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function QuotaCard({ entitlementKey, item }: { entitlementKey: string; item: QuotaUsageItem }) {
  const label = ENTITLEMENT_LABELS[entitlementKey] ?? entitlementKey.replace(/_/g, ' ');
  const unlimited = isUnlimited(item);
  const near = isNearLimit(item);
  const pct = quotaPercent(item);

  const barColor = near ? '#ef4444' : pct > 50 ? '#f59e0b' : '#22c55e';

  return (
    <View style={styles.quotaCard}>
      <View style={styles.quotaHeader}>
        <Text style={styles.quotaLabel}>{label}</Text>
        <Text style={[styles.quotaValue, near && styles.quotaValueWarn]}>
          {unlimited ? (
            'Unlimited'
          ) : (
            `${item.used} / ${item.limit}`
          )}
        </Text>
      </View>

      {!unlimited && (
        <View style={styles.progressBarContainer}>
          <View
            style={[
              styles.progressBar,
              { width: `${pct}%`, backgroundColor: barColor },
            ]}
          />
        </View>
      )}

      <View style={styles.quotaFooter}>
        {item.bonusAmount > 0 && (
          <View style={styles.bonusBadge}>
            <Ionicons name="gift-outline" size={12} color="#7c3aed" />
            <Text style={styles.bonusBadgeText}>
              +{item.bonusAmount} bonus
            </Text>
          </View>
        )}
        {!unlimited && (
          <Text style={styles.quotaRemaining}>
            {item.remaining} remaining
          </Text>
        )}
      </View>
    </View>
  );
}

function BonusCard({ bonus }: { bonus: ActiveBonus }) {
  return (
    <View style={styles.bonusCard}>
      <View style={styles.bonusHeader}>
        <View style={styles.bonusIcon}>
          <Ionicons name="gift" size={16} color="#7c3aed" />
        </View>
        <View style={styles.bonusInfo}>
          <Text style={styles.bonusLabel}>
            {ENTITLEMENT_LABELS[bonus.entitlementKey] ?? bonus.entitlementKey.replace(/_/g, ' ')}
          </Text>
          <Text style={styles.bonusDetail}>
            {bonus.numericValue != null
              ? `+${bonus.numericValue} credits`
              : bonus.booleanValue
                ? 'Enabled'
                : '—'}
          </Text>
        </View>
      </View>
      <View style={styles.bonusFooter}>
        <Text style={styles.bonusSource}>
          {bonus.sourceType} — {bonus.reason}
        </Text>
        {bonus.expiresAt && (
          <Text style={styles.bonusExpiry}>
            Expires {formatDate(bonus.expiresAt)}
          </Text>
        )}
      </View>
    </View>
  );
}

export default function UsageScreen() {
  const {
    data: quotaData,
    isLoading: quotaLoading,
    isFetching,
    refetch,
  } = useQuotaUsage();

  const isLoading = quotaLoading;

  const quotaEntries = quotaData
    ? Object.entries(quotaData.quotas).sort(([a], [b]) => {
        const order = Object.keys(ENTITLEMENT_LABELS);
        return order.indexOf(a) - order.indexOf(b);
      })
    : [];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={isFetching && !isLoading}
          onRefresh={() => refetch()}
          colors={['#1a56db']}
        />
      }
    >
      {isLoading ? (
        <ActivityIndicator color="#1a56db" style={styles.loader} />
      ) : (
        <>
          {/* Period summary. The plan row is gone: the screen reports what is
              used and what is left, and never names the tier that sets those
              limits (App Review 2.1(b)). The label reads "Current period", not
              "Billing Period" — nothing here is billed. The period was the card's
              only other row, so the card is now conditional on it — otherwise
              an org with no period renders an empty bordered box. */}
          {quotaData?.billingPeriodStart && (
            <View style={styles.summaryCard}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Current period</Text>
                <Text style={styles.summaryValue}>
                  {formatDate(quotaData.billingPeriodStart)} –{' '}
                  {formatDate(quotaData.billingPeriodEnd)}
                </Text>
              </View>
            </View>
          )}

          {/* Quota Usage */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Usage</Text>
            {quotaEntries.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>No quota data available</Text>
              </View>
            ) : (
              quotaEntries.map(([key, item]) => (
                <QuotaCard key={key} entitlementKey={key} item={item} />
              ))
            )}
          </View>

          {/* Active Bonuses */}
          {quotaData?.activeBonuses && quotaData.activeBonuses.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Active Bonuses</Text>
              {quotaData.activeBonuses.map((bonus) => (
                <BonusCard key={bonus.id} bonus={bonus} />
              ))}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  content: { padding: 16, paddingBottom: 40 },
  loader: { marginTop: 40 },
  section: { marginBottom: 24 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  summaryLabel: { fontSize: 14, color: '#6b7280' },
  summaryValue: { fontSize: 14, color: '#111827', fontWeight: '600' },
  quotaCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 1,
    elevation: 1,
  },
  quotaHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  quotaLabel: { fontSize: 14, fontWeight: '600', color: '#374151' },
  quotaValue: { fontSize: 14, color: '#6b7280', fontWeight: '500' },
  quotaValueWarn: { color: '#ef4444' },
  progressBarContainer: {
    height: 6,
    backgroundColor: '#e5e7eb',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 6,
  },
  progressBar: {
    height: '100%',
    borderRadius: 3,
  },
  quotaFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  quotaRemaining: { fontSize: 12, color: '#9ca3af' },
  bonusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f3ff',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    gap: 4,
  },
  bonusBadgeText: { fontSize: 11, color: '#7c3aed', fontWeight: '600' },
  bonusCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#7c3aed',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 1,
    elevation: 1,
  },
  bonusHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  bonusIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#f5f3ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  bonusInfo: { flex: 1 },
  bonusLabel: { fontSize: 14, fontWeight: '600', color: '#374151' },
  bonusDetail: { fontSize: 13, color: '#7c3aed', fontWeight: '500', marginTop: 1 },
  bonusFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bonusSource: { fontSize: 12, color: '#9ca3af', textTransform: 'capitalize' },
  bonusExpiry: { fontSize: 12, color: '#f59e0b', fontWeight: '500' },
  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 20,
    alignItems: 'center',
  },
  emptyText: { fontSize: 14, color: '#9ca3af' },
});

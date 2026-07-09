import { useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  AppState,
  RefreshControl,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useSubscription } from '../../features/billing/hooks/use-subscription';
import { useCancelSubscription } from '../../features/billing/hooks/use-billing';
import { PLAN_LABELS } from '../../features/billing/types';

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  active: { bg: '#dcfce7', text: '#166534' },
  trialing: { bg: '#dbeafe', text: '#1e40af' },
  past_due: { bg: '#fef3c7', text: '#92400e' },
  cancelled: { bg: '#fee2e2', text: '#991b1b' },
  cancelling: { bg: '#fef3c7', text: '#92400e' },
  suspended: { bg: '#fee2e2', text: '#991b1b' },
  expired: { bg: '#f3f4f6', text: '#6b7280' },
  complimentary: { bg: '#f3e8ff', text: '#7c3aed' },
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function SubscriptionScreen() {
  const queryClient = useQueryClient();
  const {
    data: subscription,
    isLoading,
    isFetching,
    refetch,
  } = useSubscription();
  const cancelMutation = useCancelSubscription();

  // Entitlement safety net: checkout happens in the system browser, so the
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

  function handleCancel() {
    Alert.alert(
      'Cancel Subscription',
      'Your subscription will remain active until the end of the current billing period. Are you sure?',
      [
        { text: 'Keep Subscription', style: 'cancel' },
        {
          text: 'Cancel',
          style: 'destructive',
          onPress: () => {
            cancelMutation.mutate(
              { cancelAtPeriodEnd: true },
              {
                onSuccess: () => {
                  Alert.alert(
                    'Subscription Cancelled',
                    'Your subscription will end at the end of the current period.',
                  );
                },
                onError: (error) => {
                  Alert.alert(
                    'Error',
                    error instanceof Error ? error.message : 'Failed to cancel subscription',
                  );
                },
              },
            );
          },
        },
      ],
    );
  }

  const statusStyle = subscription
    ? STATUS_COLORS[subscription.status] ?? STATUS_COLORS['active']
    : STATUS_COLORS['active'];

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
      ) : !subscription ? (
        <View style={styles.emptyCard}>
          <Ionicons name="card-outline" size={48} color="#9ca3af" />
          <Text style={styles.emptyTitle}>No Active Subscription</Text>
          <Text style={styles.emptyText}>
            Choose a plan to unlock AI-powered legal research tools.
          </Text>
          <TouchableOpacity
            style={styles.upgradeButton}
            onPress={() => router.push('/settings/plans')}
          >
            <Text style={styles.upgradeButtonText}>View Plans</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {/* Plan Card */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Current Plan</Text>
            <View style={styles.card}>
              <View style={styles.planHeader}>
                <Text style={styles.planName}>
                  {PLAN_LABELS[subscription.planCode] ?? subscription.planCode}
                </Text>
                <View
                  style={[styles.statusBadge, { backgroundColor: statusStyle.bg }]}
                >
                  <Text style={[styles.statusText, { color: statusStyle.text }]}>
                    {subscription.status.replace(/_/g, ' ')}
                  </Text>
                </View>
              </View>

              <View style={styles.divider} />

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Billing Period</Text>
                <Text style={styles.detailValue}>
                  {subscription.billingPeriod === 'annual' ? 'Annual' : 'Monthly'}
                </Text>
              </View>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Seats</Text>
                <Text style={styles.detailValue}>{subscription.seats}</Text>
              </View>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Current Period</Text>
                <Text style={styles.detailValue}>
                  {formatDate(subscription.currentPeriodStart)} –{' '}
                  {formatDate(subscription.currentPeriodEnd)}
                </Text>
              </View>

              {subscription.trialEnd && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Trial Ends</Text>
                  <Text style={styles.detailValue}>
                    {formatDate(subscription.trialEnd)}
                  </Text>
                </View>
              )}

              {subscription.cancelAtPeriodEnd && (
                <View style={styles.cancelNotice}>
                  <Ionicons name="warning-outline" size={16} color="#92400e" />
                  <Text style={styles.cancelNoticeText}>
                    Subscription will end on {formatDate(subscription.currentPeriodEnd)}
                  </Text>
                </View>
              )}

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Member Since</Text>
                <Text style={styles.detailValue}>
                  {formatDate(subscription.createdAt)}
                </Text>
              </View>
            </View>
          </View>

          {/* Actions */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Manage</Text>
            <View style={styles.card}>
              <TouchableOpacity
                style={styles.actionRow}
                onPress={() => router.push('/settings/plans')}
              >
                <View style={[styles.actionIcon, { backgroundColor: '#eff6ff' }]}>
                  <Ionicons name="arrow-up-circle-outline" size={20} color="#1a56db" />
                </View>
                <View style={styles.actionInfo}>
                  <Text style={styles.actionLabel}>Change Plan</Text>
                  <Text style={styles.actionSublabel}>
                    Upgrade or downgrade your subscription
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
              </TouchableOpacity>

              <View style={styles.divider} />

              <TouchableOpacity
                style={styles.actionRow}
                onPress={() => router.push('/settings/usage')}
              >
                <View style={[styles.actionIcon, { backgroundColor: '#f0fdf4' }]}>
                  <Ionicons name="bar-chart-outline" size={20} color="#16a34a" />
                </View>
                <View style={styles.actionInfo}>
                  <Text style={styles.actionLabel}>Usage & Quotas</Text>
                  <Text style={styles.actionSublabel}>
                    Track your feature usage and limits
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
              </TouchableOpacity>

              {subscription.status === 'active' &&
                !subscription.cancelAtPeriodEnd &&
                subscription.planCode !== 'free' && (
                  <>
                    <View style={styles.divider} />
                    <TouchableOpacity
                      style={styles.actionRow}
                      onPress={handleCancel}
                      disabled={cancelMutation.isPending}
                    >
                      <View style={[styles.actionIcon, { backgroundColor: '#fef2f2' }]}>
                        {cancelMutation.isPending ? (
                          <ActivityIndicator size="small" color="#dc2626" />
                        ) : (
                          <Ionicons name="close-circle-outline" size={20} color="#dc2626" />
                        )}
                      </View>
                      <View style={styles.actionInfo}>
                        <Text style={[styles.actionLabel, { color: '#dc2626' }]}>
                          Cancel Subscription
                        </Text>
                        <Text style={styles.actionSublabel}>
                          Cancel at end of billing period
                        </Text>
                      </View>
                    </TouchableOpacity>
                  </>
                )}
            </View>
          </View>
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
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  planHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  planName: { fontSize: 22, fontWeight: '700', color: '#111827' },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  divider: {
    height: 1,
    backgroundColor: '#e5e7eb',
    marginVertical: 12,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  detailLabel: { fontSize: 14, color: '#6b7280' },
  detailValue: { fontSize: 14, color: '#111827', fontWeight: '500' },
  cancelNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fffbeb',
    borderRadius: 8,
    padding: 10,
    marginVertical: 8,
    gap: 8,
  },
  cancelNoticeText: { fontSize: 13, color: '#92400e', flex: 1 },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  actionInfo: { flex: 1 },
  actionLabel: { fontSize: 15, fontWeight: '600', color: '#111827' },
  actionSublabel: { fontSize: 12, color: '#6b7280', marginTop: 1 },
  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginTop: 16,
  },
  emptyText: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  upgradeButton: {
    backgroundColor: '#1a56db',
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    marginTop: 20,
  },
  upgradeButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});

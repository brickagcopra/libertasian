import { useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useUploads } from '../../features/camera-scan/hooks/use-uploads';
import { useQuotaUsage } from '../../features/billing/hooks/use-quotas';
import type { UploadListItem } from '../../features/camera-scan/types';

function statusColor(status: string): string {
  switch (status) {
    case 'completed':
      return '#059669';
    case 'processing':
    case 'pending':
      return '#d97706';
    case 'failed':
      return '#ef4444';
    default:
      return '#6b7280';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'completed':
      return 'Done';
    case 'processing':
      return 'Processing';
    case 'pending':
      return 'Pending';
    case 'failed':
      return 'Failed';
    default:
      return status;
  }
}

function ScanItem({ item }: { item: UploadListItem }) {
  const handlePress = useCallback(() => {
    router.push({ pathname: '/scan/result/[id]', params: { id: item.id } });
  }, [item.id]);

  const dateStr = new Date(item.createdAt).toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <TouchableOpacity style={styles.scanItem} onPress={handlePress} activeOpacity={0.7}>
      <View style={styles.scanItemIcon}>
        <Ionicons name="document-text-outline" size={24} color="#6b7280" />
      </View>
      <View style={styles.scanItemContent}>
        <Text style={styles.scanItemTitle} numberOfLines={1}>
          {item.originalFilename ?? `Scan ${item.id.slice(0, 8)}`}
        </Text>
        <Text style={styles.scanItemDate}>{dateStr}</Text>
      </View>
      <View style={[styles.statusBadge, { backgroundColor: statusColor(item.processingStatus) + '20' }]}>
        <View style={[styles.statusDot, { backgroundColor: statusColor(item.processingStatus) }]} />
        <Text style={[styles.statusText, { color: statusColor(item.processingStatus) }]}>
          {statusLabel(item.processingStatus)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default function ScanTab() {
  const { data, isLoading, refetch, isRefetching } = useUploads({ uploadType: 'camera_scan' });
  const { data: quotaData } = useQuotaUsage();

  const uploads = data?.uploads ?? [];
  const cameraQuota = quotaData?.quotas?.['camera_scans_per_month'];
  const monthlyLimit = cameraQuota?.limit ?? null;
  const isUnlimited = monthlyLimit === null || monthlyLimit < 0;

  const handleStartScan = useCallback(() => {
    router.push('/scan/capture');
  }, []);

  const renderItem = useCallback(({ item }: { item: UploadListItem }) => {
    return <ScanItem item={item} />;
  }, []);

  return (
    <View style={styles.container}>
      {/* Scan CTA Card */}
      <View style={styles.ctaCard}>
        <View style={styles.ctaHeader}>
          <View style={styles.ctaIconContainer}>
            <Ionicons name="camera" size={28} color="#1a56db" />
          </View>
          <View style={styles.ctaTextContainer}>
            <Text style={styles.ctaTitle}>Scan Document</Text>
            <Text style={styles.ctaSubtitle}>
              Capture legal documents with your camera
            </Text>
          </View>
        </View>

        {/* Quota display */}
        {!isUnlimited && monthlyLimit !== null && monthlyLimit > 0 && (
          <View style={styles.quotaRow}>
            <Ionicons name="pie-chart-outline" size={14} color="#6b7280" />
            <Text style={styles.quotaText}>
              {cameraQuota?.used ?? 0} / {monthlyLimit} scans this month
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={styles.scanButton}
          onPress={handleStartScan}
          activeOpacity={0.7}
        >
          <Ionicons name="scan-outline" size={20} color="#fff" />
          <Text style={styles.scanButtonText}>Start Scan</Text>
        </TouchableOpacity>
      </View>

      {/* Recent scans header */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Recent Scans</Text>
      </View>

      {/* Scan list */}
      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#1a56db" />
        </View>
      ) : (
        <FlatList
          data={uploads}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#1a56db" />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="images-outline" size={48} color="#d1d5db" />
              <Text style={styles.emptyTitle}>No scans yet</Text>
              <Text style={styles.emptySubtitle}>
                Tap &quot;Start Scan&quot; to capture your first document
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  ctaCard: {
    backgroundColor: '#fff',
    margin: 16,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  ctaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  ctaIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#eff6ff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  ctaTextContainer: {
    flex: 1,
  },
  ctaTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#111827',
  },
  ctaSubtitle: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 2,
  },
  quotaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  quotaText: {
    fontSize: 13,
    color: '#6b7280',
  },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1a56db',
    paddingVertical: 12,
    borderRadius: 10,
  },
  scanButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  sectionHeader: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  scanItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 10,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  scanItemIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#f3f4f6',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  scanItemContent: {
    flex: 1,
  },
  scanItemTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: '#111827',
  },
  scanItemDate: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 48,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6b7280',
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#9ca3af',
    textAlign: 'center',
    marginTop: 4,
  },
});

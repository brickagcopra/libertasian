import { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Alert,
  RefreshControl,
  TextInput,
  ScrollView,
  Platform,
} from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import {
  useApiKeys,
  useCreateApiKey,
  useUpdateApiKey,
  useDeleteApiKey,
} from '../../features/api-keys/hooks/use-api-keys';
import type {
  ApiKeyListItem,
  ApiKeyPermission,
} from '../../features/api-keys/types';
import {
  ALL_PERMISSIONS,
  PERMISSION_LABELS,
} from '../../features/api-keys/types';

type ScreenMode = 'list' | 'create';

export default function ApiKeysScreen() {
  const [mode, setMode] = useState<ScreenMode>('list');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const { data, isLoading, isFetching, refetch } = useApiKeys({ limit: 50 });
  const deleteApiKey = useDeleteApiKey();
  const updateApiKey = useUpdateApiKey();

  const apiKeys = useMemo(() => data?.data ?? [], [data]);

  const handleDelete = useCallback(
    (key: ApiKeyListItem) => {
      Alert.alert(
        'Delete API Key',
        `Are you sure you want to delete "${key.name}"? This action cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                await deleteApiKey.mutateAsync(key.id);
              } catch (err) {
                Alert.alert(
                  'Error',
                  err instanceof Error ? err.message : 'Failed to delete API key',
                );
              }
            },
          },
        ],
      );
    },
    [deleteApiKey],
  );

  const handleToggleActive = useCallback(
    async (key: ApiKeyListItem) => {
      try {
        await updateApiKey.mutateAsync({
          id: key.id,
          data: { isActive: !key.isActive },
        });
      } catch (err) {
        Alert.alert(
          'Error',
          err instanceof Error ? err.message : 'Failed to update API key',
        );
      }
    },
    [updateApiKey],
  );

  const handleKeyCreated = useCallback((rawKey: string) => {
    setCreatedKey(rawKey);
    setCopiedKey(false);
    setMode('list');
  }, []);

  const handleCopyKey = useCallback(async () => {
    if (createdKey) {
      await Clipboard.setStringAsync(createdKey);
      setCopiedKey(true);
    }
  }, [createdKey]);

  const handleDismissKeyBanner = useCallback(() => {
    setCreatedKey(null);
    setCopiedKey(false);
  }, []);

  const renderKeyItem = useCallback(
    ({ item }: { item: ApiKeyListItem }) => (
      <ApiKeyCard
        item={item}
        onDelete={handleDelete}
        onToggleActive={handleToggleActive}
      />
    ),
    [handleDelete, handleToggleActive],
  );

  const keyExtractor = useCallback((item: ApiKeyListItem) => item.id, []);

  if (mode === 'create') {
    return (
      <>
        <Stack.Screen options={{ title: 'Create API Key' }} />
        <CreateApiKeyForm
          onCreated={handleKeyCreated}
          onCancel={() => setMode('list')}
        />
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: 'API Keys',
          headerRight: () => (
            <TouchableOpacity
              onPress={() => setMode('create')}
              activeOpacity={0.7}
              style={styles.headerButton}
            >
              <Ionicons name="add" size={24} color="#1a56db" />
            </TouchableOpacity>
          ),
        }}
      />

      <View style={styles.container}>
        {/* Created key banner (one-time display) */}
        {createdKey ? (
          <View style={styles.keyBanner}>
            <View style={styles.keyBannerHeader}>
              <View style={styles.keyBannerIconContainer}>
                <Ionicons name="key-outline" size={18} color="#059669" />
              </View>
              <Text style={styles.keyBannerTitle}>API Key Created</Text>
              <TouchableOpacity
                onPress={handleDismissKeyBanner}
                activeOpacity={0.7}
              >
                <Ionicons name="close" size={20} color="#6b7280" />
              </TouchableOpacity>
            </View>
            <Text style={styles.keyBannerWarning}>
              Copy this key now. It will not be shown again.
            </Text>
            <View style={styles.keyDisplay}>
              <Text style={styles.keyText} numberOfLines={1} ellipsizeMode="middle">
                {createdKey}
              </Text>
              <TouchableOpacity
                onPress={handleCopyKey}
                activeOpacity={0.7}
                style={styles.copyButton}
              >
                <Ionicons
                  name={copiedKey ? 'checkmark' : 'copy-outline'}
                  size={18}
                  color={copiedKey ? '#059669' : '#1a56db'}
                />
                <Text
                  style={[
                    styles.copyText,
                    copiedKey && styles.copyTextSuccess,
                  ]}
                >
                  {copiedKey ? 'Copied' : 'Copy'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#1a56db" />
          </View>
        ) : apiKeys.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconContainer}>
              <Ionicons name="key-outline" size={48} color="#9ca3af" />
            </View>
            <Text style={styles.emptyTitle}>No API Keys</Text>
            <Text style={styles.emptyDescription}>
              Create an API key to integrate LIBERTASIAN with your applications.
              Requires an Enterprise subscription.
            </Text>
            <TouchableOpacity
              style={styles.emptyButton}
              onPress={() => setMode('create')}
              activeOpacity={0.7}
            >
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={styles.emptyButtonText}>Create API Key</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={apiKeys}
            renderItem={renderKeyItem}
            keyExtractor={keyExtractor}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={isFetching && !isLoading}
                onRefresh={() => refetch()}
                colors={['#1a56db']}
              />
            }
            ItemSeparatorComponent={ListSeparator}
          />
        )}
      </View>
    </>
  );
}

// ─── API Key Card ───────────────────────────────────────────

function ApiKeyCard({
  item,
  onDelete,
  onToggleActive,
}: {
  item: ApiKeyListItem;
  onDelete: (key: ApiKeyListItem) => void;
  onToggleActive: (key: ApiKeyListItem) => void;
}) {
  const isExpired = item.expiresAt && new Date(item.expiresAt) < new Date();

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {item.name}
          </Text>
          <View
            style={[
              styles.statusBadge,
              item.isActive && !isExpired
                ? styles.statusActive
                : styles.statusInactive,
            ]}
          >
            <Text
              style={[
                styles.statusText,
                item.isActive && !isExpired
                  ? styles.statusTextActive
                  : styles.statusTextInactive,
              ]}
            >
              {isExpired ? 'Expired' : item.isActive ? 'Active' : 'Inactive'}
            </Text>
          </View>
        </View>
        <Text style={styles.keyPrefixText}>{item.keyPrefix}...</Text>
      </View>

      {/* Permissions */}
      <View style={styles.permissionsRow}>
        {item.permissions.map((perm) => (
          <View key={perm} style={styles.permBadge}>
            <Text style={styles.permText}>
              {PERMISSION_LABELS[perm] ?? perm}
            </Text>
          </View>
        ))}
      </View>

      {/* Metadata */}
      <View style={styles.metaRow}>
        <View style={styles.metaItem}>
          <Ionicons name="speedometer-outline" size={13} color="#9ca3af" />
          <Text style={styles.metaText}>{item.rateLimitPerMinute}/min</Text>
        </View>
        <View style={styles.metaItem}>
          <Ionicons name="calendar-outline" size={13} color="#9ca3af" />
          <Text style={styles.metaText}>
            {new Date(item.createdAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </Text>
        </View>
        {item.lastUsedAt ? (
          <View style={styles.metaItem}>
            <Ionicons name="time-outline" size={13} color="#9ca3af" />
            <Text style={styles.metaText}>
              Used{' '}
              {new Date(item.lastUsedAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              })}
            </Text>
          </View>
        ) : null}
      </View>

      {item.expiresAt ? (
        <View style={styles.expiryRow}>
          <Ionicons
            name="alert-circle-outline"
            size={13}
            color={isExpired ? '#dc2626' : '#d97706'}
          />
          <Text
            style={[
              styles.expiryText,
              isExpired ? styles.expiryExpired : styles.expiryUpcoming,
            ]}
          >
            {isExpired ? 'Expired' : 'Expires'}{' '}
            {new Date(item.expiresAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </Text>
        </View>
      ) : null}

      {/* Actions */}
      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[
            styles.actionButton,
            item.isActive ? styles.actionDeactivate : styles.actionActivate,
          ]}
          onPress={() => onToggleActive(item)}
          activeOpacity={0.7}
        >
          <Ionicons
            name={item.isActive ? 'pause-outline' : 'play-outline'}
            size={16}
            color={item.isActive ? '#d97706' : '#059669'}
          />
          <Text
            style={[
              styles.actionText,
              item.isActive
                ? styles.actionTextDeactivate
                : styles.actionTextActivate,
            ]}
          >
            {item.isActive ? 'Deactivate' : 'Activate'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, styles.actionDelete]}
          onPress={() => onDelete(item)}
          activeOpacity={0.7}
        >
          <Ionicons name="trash-outline" size={16} color="#dc2626" />
          <Text style={[styles.actionText, styles.actionTextDelete]}>
            Delete
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Create API Key Form ────────────────────────────────────

function CreateApiKeyForm({
  onCreated,
  onCancel,
}: {
  onCreated: (rawKey: string) => void;
  onCancel: () => void;
}) {
  const createApiKey = useCreateApiKey();
  const [name, setName] = useState('');
  const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(
    new Set(),
  );
  const [rateLimit, setRateLimit] = useState('60');

  const canSubmit =
    name.trim().length > 0 &&
    selectedPermissions.size > 0 &&
    !createApiKey.isPending;

  const togglePermission = useCallback((perm: string) => {
    setSelectedPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(perm)) {
        next.delete(perm);
      } else {
        next.add(perm);
      }
      return next;
    });
  }, []);

  const handleSubmit = async () => {
    if (!canSubmit) return;

    const parsedRate = parseInt(rateLimit, 10);
    const rateLimitValue =
      !isNaN(parsedRate) && parsedRate >= 1 && parsedRate <= 1000
        ? parsedRate
        : 60;

    try {
      const result = await createApiKey.mutateAsync({
        name: name.trim(),
        permissions: Array.from(selectedPermissions),
        rateLimitPerMinute: rateLimitValue,
      });
      onCreated(result.key);
    } catch (err) {
      Alert.alert(
        'Error',
        err instanceof Error ? err.message : 'Failed to create API key',
      );
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.formContent}
      keyboardShouldPersistTaps="handled"
    >
      {createApiKey.isError ? (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle" size={18} color="#dc2626" />
          <Text style={styles.errorText}>
            {createApiKey.error instanceof Error
              ? createApiKey.error.message
              : 'Failed to create API key'}
          </Text>
        </View>
      ) : null}

      {/* Name */}
      <View style={styles.formGroup}>
        <Text style={styles.formLabel}>Name</Text>
        <TextInput
          style={styles.formInput}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Production API"
          placeholderTextColor="#9ca3af"
          maxLength={255}
          autoFocus
        />
        <Text style={styles.formHint}>
          A descriptive name to identify this key.
        </Text>
      </View>

      {/* Permissions */}
      <View style={styles.formGroup}>
        <Text style={styles.formLabel}>Permissions</Text>
        <Text style={styles.formHint}>
          Select at least one permission for this key.
        </Text>
        <View style={styles.permGrid}>
          {ALL_PERMISSIONS.map((perm) => {
            const isSelected = selectedPermissions.has(perm.value);
            return (
              <TouchableOpacity
                key={perm.value}
                style={[
                  styles.permChip,
                  isSelected && styles.permChipSelected,
                ]}
                onPress={() => togglePermission(perm.value)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={isSelected ? 'checkbox' : 'square-outline'}
                  size={18}
                  color={isSelected ? '#1a56db' : '#9ca3af'}
                />
                <Text
                  style={[
                    styles.permChipText,
                    isSelected && styles.permChipTextSelected,
                  ]}
                >
                  {perm.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Rate Limit */}
      <View style={styles.formGroup}>
        <Text style={styles.formLabel}>Rate Limit (requests/min)</Text>
        <TextInput
          style={styles.formInput}
          value={rateLimit}
          onChangeText={setRateLimit}
          placeholder="60"
          placeholderTextColor="#9ca3af"
          keyboardType="numeric"
          maxLength={4}
        />
        <Text style={styles.formHint}>
          Between 1 and 1000. Default is 60 requests per minute.
        </Text>
      </View>

      {/* Buttons */}
      <View style={styles.formButtons}>
        <TouchableOpacity
          style={[styles.formButton, styles.formButtonPrimary]}
          onPress={handleSubmit}
          disabled={!canSubmit}
          activeOpacity={0.7}
        >
          {createApiKey.isPending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Ionicons name="key-outline" size={18} color="#fff" />
              <Text style={styles.formButtonPrimaryText}>Create Key</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.formButton, styles.formButtonCancel]}
          onPress={onCancel}
          activeOpacity={0.7}
        >
          <Text style={styles.formButtonCancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

// ─── List Separator ─────────────────────────────────────────

function ListSeparator() {
  return <View style={styles.separator} />;
}

// ─── Styles ─────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  listContent: { padding: 16, paddingBottom: 40 },
  formContent: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerButton: { paddingHorizontal: 8 },
  separator: { height: 10 },

  // Key banner
  keyBanner: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    borderRadius: 12,
    padding: 14,
    margin: 16,
    marginBottom: 0,
  },
  keyBannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  keyBannerIconContainer: { marginRight: 8 },
  keyBannerTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#065f46',
  },
  keyBannerWarning: {
    fontSize: 12,
    color: '#047857',
    marginBottom: 10,
  },
  keyDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#d1fae5',
  },
  keyText: {
    flex: 1,
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: '#111827',
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 10,
    gap: 4,
  },
  copyText: { fontSize: 13, fontWeight: '600', color: '#1a56db' },
  copyTextSuccess: { color: '#059669' },

  // Empty state
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
  },
  emptyDescription: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a56db',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  emptyButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },

  // Card
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  cardHeader: { marginBottom: 10 },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  cardTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginRight: 8,
  },
  keyPrefixText: {
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: '#6b7280',
  },

  // Status badge
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  statusActive: { backgroundColor: '#ecfdf5' },
  statusInactive: { backgroundColor: '#f3f4f6' },
  statusText: { fontSize: 11, fontWeight: '600' },
  statusTextActive: { color: '#059669' },
  statusTextInactive: { color: '#6b7280' },

  // Permissions
  permissionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  permBadge: {
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  permText: { fontSize: 11, color: '#374151', fontWeight: '500' },

  // Metadata
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 6,
  },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, color: '#9ca3af' },

  // Expiry
  expiryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 10,
  },
  expiryText: { fontSize: 12, fontWeight: '500' },
  expiryExpired: { color: '#dc2626' },
  expiryUpcoming: { color: '#d97706' },

  // Actions
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    paddingTop: 10,
    marginTop: 4,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 6,
    gap: 4,
  },
  actionActivate: { backgroundColor: '#ecfdf5' },
  actionDeactivate: { backgroundColor: '#fffbeb' },
  actionDelete: { backgroundColor: '#fef2f2' },
  actionText: { fontSize: 13, fontWeight: '500' },
  actionTextActivate: { color: '#059669' },
  actionTextDeactivate: { color: '#d97706' },
  actionTextDelete: { color: '#dc2626' },

  // Form
  formGroup: { marginBottom: 20 },
  formLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
  },
  formInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
  },
  formHint: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 4,
  },
  permGrid: { marginTop: 8, gap: 6 },
  permChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  permChipSelected: {
    borderColor: '#1a56db',
    backgroundColor: '#eff6ff',
  },
  permChipText: { fontSize: 14, color: '#6b7280' },
  permChipTextSelected: { color: '#1a56db', fontWeight: '500' },
  formButtons: { gap: 10, marginTop: 8 },
  formButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: 8,
    gap: 6,
  },
  formButtonPrimary: { backgroundColor: '#1a56db' },
  formButtonPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  formButtonCancel: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  formButtonCancelText: { color: '#374151', fontSize: 16, fontWeight: '500' },

  // Error
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 8,
    padding: 12,
    gap: 8,
    marginBottom: 16,
  },
  errorText: { flex: 1, fontSize: 13, color: '#dc2626' },
});

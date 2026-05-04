import { useCallback, useState } from 'react';
import {
  View,
  Text,
  Modal,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Share,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { DatePickerField } from '../../../components/date-picker-field';
import {
  useShares,
  useCreateShare,
  useUpdateShare,
  useRevokeShare,
} from '../hooks/use-shares';
import type { ShareListItem, SharePermission } from '../types';

const APP_URL =
  (Constants.expoConfig?.extra?.['appUrl'] as string | undefined) ??
  'https://libertasian.com';

interface ShareSheetProps {
  visible: boolean;
  onClose: () => void;
  entityType: 'matter';
  entityId: string;
  entityTitle: string;
}

const PERMISSION_OPTIONS: { value: SharePermission; label: string; desc: string }[] = [
  { value: 'view', label: 'View', desc: 'Read-only access' },
  { value: 'comment', label: 'Comment', desc: 'View + add comments' },
  { value: 'edit', label: 'Edit', desc: 'Full access' },
];

const PERMISSION_COLORS: Record<string, { bg: string; text: string }> = {
  view: { bg: '#dbeafe', text: '#1d4ed8' },
  comment: { bg: '#fef3c7', text: '#d97706' },
  edit: { bg: '#dcfce7', text: '#16a34a' },
};

export function ShareSheet({
  visible,
  onClose,
  entityType,
  entityId,
  entityTitle,
}: ShareSheetProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);

  // Form state
  const [permission, setPermission] = useState<SharePermission>('view');
  const [label, setLabel] = useState('');
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [password, setPassword] = useState('');
  const [expiresAt, setExpiresAt] = useState<Date | null>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d;
  });

  const { data: sharesData, isLoading: loadingShares } = useShares({
    entityType,
    entityId,
  });
  const createShare = useCreateShare();
  const updateShare = useUpdateShare();
  const revokeShare = useRevokeShare();

  const shares = sharesData?.data ?? [];

  const resetForm = useCallback(() => {
    setPermission('view');
    setLabel('');
    setPasswordEnabled(false);
    setPassword('');
    const d = new Date();
    d.setDate(d.getDate() + 7);
    setExpiresAt(d);
    setShowCreateForm(false);
    setNewToken(null);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  const handleCreate = useCallback(async () => {
    try {
      const result = await createShare.mutateAsync({
        entityType,
        entityId,
        permission,
        label: label.trim() || undefined,
        password: passwordEnabled && password.length >= 4 ? password : undefined,
        expiresAt: expiresAt?.toISOString(),
      });
      setNewToken(result.token);
      setShowCreateForm(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create share link';
      Alert.alert('Error', message);
    }
  }, [createShare, entityType, entityId, permission, label, passwordEnabled, password, expiresAt]);

  const handleShareLink = useCallback(
    async (token: string) => {
      const shareUrl = `${APP_URL}/shared/${token}`;
      try {
        await Share.share({
          message: `${entityTitle} — Shared via LIBERTASIAN\n${shareUrl}`,
          url: shareUrl,
        });
      } catch {
        // User cancelled share
      }
    },
    [entityTitle],
  );

  const handleToggleActive = useCallback(
    (share: ShareListItem) => {
      updateShare.mutate({ id: share.id, isActive: !share.isActive });
    },
    [updateShare],
  );

  const handleRevoke = useCallback(
    (share: ShareListItem) => {
      Alert.alert(
        'Revoke Share Link',
        'This will permanently delete this share link. Anyone with the link will lose access.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Revoke',
            style: 'destructive',
            onPress: () => revokeShare.mutate(share.id),
          },
        ],
      );
    },
    [revokeShare],
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerHandle} />
            <View style={styles.headerRow}>
              <Text style={styles.headerTitle}>Share</Text>
              <TouchableOpacity onPress={handleClose} hitSlop={8}>
                <Ionicons name="close" size={22} color="#6b7280" />
              </TouchableOpacity>
            </View>
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {entityTitle}
            </Text>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* New token banner */}
            {newToken ? (
              <View style={styles.tokenBanner}>
                <View style={styles.tokenBannerHeader}>
                  <Ionicons name="checkmark-circle" size={20} color="#16a34a" />
                  <Text style={styles.tokenBannerTitle}>Share link created!</Text>
                </View>
                <Text style={styles.tokenBannerNote}>
                  This link is shown only once. Share it now.
                </Text>
                <TouchableOpacity
                  style={styles.shareButton}
                  onPress={() => handleShareLink(newToken)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="share-outline" size={18} color="#fff" />
                  <Text style={styles.shareButtonText}>Share Link</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* Create new share form */}
            {showCreateForm ? (
              <View style={styles.createForm}>
                <Text style={styles.sectionTitle}>New Share Link</Text>

                {/* Permission selector */}
                <Text style={styles.fieldLabel}>Permission</Text>
                <View style={styles.permissionRow}>
                  {PERMISSION_OPTIONS.map((opt) => {
                    const isSelected = permission === opt.value;
                    const colors = PERMISSION_COLORS[opt.value];
                    return (
                      <TouchableOpacity
                        key={opt.value}
                        style={[
                          styles.permissionChip,
                          isSelected && { backgroundColor: colors?.bg, borderColor: colors?.text },
                        ]}
                        onPress={() => setPermission(opt.value)}
                      >
                        <Text
                          style={[
                            styles.permissionChipText,
                            isSelected && { color: colors?.text, fontWeight: '600' },
                          ]}
                        >
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={styles.fieldHint}>
                  {PERMISSION_OPTIONS.find((o) => o.value === permission)?.desc}
                </Text>

                {/* Label */}
                <Text style={styles.fieldLabel}>Label (optional)</Text>
                <TextInput
                  style={styles.textInput}
                  value={label}
                  onChangeText={setLabel}
                  placeholder="e.g. For client review"
                  placeholderTextColor="#9ca3af"
                  maxLength={255}
                />

                {/* Password */}
                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>Password protect</Text>
                  <Switch
                    value={passwordEnabled}
                    onValueChange={setPasswordEnabled}
                    trackColor={{ false: '#e5e7eb', true: '#93c5fd' }}
                    thumbColor={passwordEnabled ? '#1a56db' : '#f4f4f5'}
                  />
                </View>
                {passwordEnabled ? (
                  <TextInput
                    style={styles.textInput}
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Enter password (min 4 characters)"
                    placeholderTextColor="#9ca3af"
                    secureTextEntry
                    maxLength={128}
                  />
                ) : null}

                {/* Expiry */}
                <DatePickerField
                  label="Expires"
                  value={expiresAt}
                  onChange={setExpiresAt}
                  placeholder="No expiry"
                  minimumDate={new Date()}
                  clearable
                />

                {/* Actions */}
                <View style={styles.formActions}>
                  <TouchableOpacity
                    style={styles.cancelButton}
                    onPress={() => setShowCreateForm(false)}
                  >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.createButton,
                      (createShare.isPending || (passwordEnabled && password.length < 4)) &&
                        styles.disabledButton,
                    ]}
                    onPress={handleCreate}
                    disabled={createShare.isPending || (passwordEnabled && password.length < 4)}
                  >
                    {createShare.isPending ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="link-outline" size={16} color="#fff" />
                        <Text style={styles.createButtonText}>Create Link</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ) : !newToken ? (
              <TouchableOpacity
                style={styles.newLinkButton}
                onPress={() => setShowCreateForm(true)}
                activeOpacity={0.7}
              >
                <Ionicons name="add-circle-outline" size={18} color="#1a56db" />
                <Text style={styles.newLinkButtonText}>Create Share Link</Text>
              </TouchableOpacity>
            ) : null}

            {/* Active shares list */}
            <Text style={styles.sectionTitle}>
              Active Links ({shares.length})
            </Text>

            {loadingShares ? (
              <ActivityIndicator
                size="small"
                color="#1a56db"
                style={{ marginTop: 12 }}
              />
            ) : shares.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="link-outline" size={32} color="#d1d5db" />
                <Text style={styles.emptyStateText}>No share links yet</Text>
              </View>
            ) : (
              shares.map((share) => (
                <ShareCard
                  key={share.id}
                  share={share}
                  onToggleActive={() => handleToggleActive(share)}
                  onRevoke={() => handleRevoke(share)}
                  isUpdating={updateShare.isPending}
                />
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Share Card ─────────────────────────────────────────────

function ShareCard({
  share,
  onToggleActive,
  onRevoke,
  isUpdating,
}: {
  share: ShareListItem;
  onToggleActive: () => void;
  onRevoke: () => void;
  isUpdating: boolean;
}) {
  const colors = PERMISSION_COLORS[share.permission] ?? PERMISSION_COLORS['view'];
  const isExpired = share.expiresAt && new Date(share.expiresAt) < new Date();

  return (
    <View style={[styles.shareCard, !share.isActive && styles.shareCardInactive]}>
      <View style={styles.shareCardHeader}>
        <View style={styles.shareCardMeta}>
          <View style={[styles.permBadge, { backgroundColor: colors.bg }]}>
            <Text style={[styles.permBadgeText, { color: colors.text }]}>
              {share.permission}
            </Text>
          </View>
          {share.isPasswordProtected ? (
            <Ionicons name="lock-closed" size={14} color="#6b7280" />
          ) : null}
          {isExpired ? (
            <View style={styles.expiredBadge}>
              <Text style={styles.expiredBadgeText}>Expired</Text>
            </View>
          ) : null}
          {!share.isActive ? (
            <View style={styles.inactiveBadge}>
              <Text style={styles.inactiveBadgeText}>Inactive</Text>
            </View>
          ) : null}
        </View>
        <Switch
          value={share.isActive}
          onValueChange={onToggleActive}
          disabled={isUpdating}
          trackColor={{ false: '#e5e7eb', true: '#93c5fd' }}
          thumbColor={share.isActive ? '#1a56db' : '#f4f4f5'}
        />
      </View>

      {share.label ? (
        <Text style={styles.shareLabel} numberOfLines={1}>
          {share.label}
        </Text>
      ) : null}

      <View style={styles.shareStats}>
        <Text style={styles.statText}>
          {share.accessCount} {share.accessCount === 1 ? 'view' : 'views'}
        </Text>
        <Text style={styles.statDot}> </Text>
        <Text style={styles.statText}>
          Created{' '}
          {new Date(share.createdAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })}
        </Text>
        {share.expiresAt && !isExpired ? (
          <>
            <Text style={styles.statDot}> </Text>
            <Text style={styles.statText}>
              Expires{' '}
              {new Date(share.expiresAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              })}
            </Text>
          </>
        ) : null}
      </View>

      <TouchableOpacity
        style={styles.revokeButton}
        onPress={onRevoke}
        activeOpacity={0.7}
      >
        <Ionicons name="trash-outline" size={14} color="#dc2626" />
        <Text style={styles.revokeButtonText}>Revoke</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  headerHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#d1d5db',
    alignSelf: 'center',
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 2,
  },

  body: { flex: 1 },
  bodyContent: { padding: 16, paddingBottom: 40 },

  // Token banner
  tokenBanner: {
    backgroundColor: '#f0fdf4',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  tokenBannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  tokenBannerTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#166534',
  },
  tokenBannerNote: {
    fontSize: 13,
    color: '#15803d',
    marginBottom: 10,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#1a56db',
    borderRadius: 8,
    paddingVertical: 10,
  },
  shareButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },

  // New link button
  newLinkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#eff6ff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderStyle: 'dashed',
    paddingVertical: 12,
    marginBottom: 20,
  },
  newLinkButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a56db',
  },

  // Section
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 10,
  },

  // Create form
  createForm: {
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    gap: 10,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginTop: 4,
  },
  fieldHint: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: -4,
  },
  textInput: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
  },
  permissionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  permissionChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  permissionChipText: {
    fontSize: 13,
    color: '#6b7280',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  switchLabel: {
    fontSize: 14,
    color: '#374151',
    fontWeight: '500',
  },
  formActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  cancelButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6b7280',
  },
  createButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#1a56db',
  },
  createButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  disabledButton: {
    opacity: 0.5,
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  emptyStateText: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 6,
  },

  // Share card
  shareCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  shareCardInactive: {
    opacity: 0.6,
  },
  shareCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  shareCardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  permBadge: {
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  permBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  expiredBadge: {
    backgroundColor: '#fee2e2',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  expiredBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#dc2626',
  },
  inactiveBadge: {
    backgroundColor: '#f3f4f6',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  inactiveBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#6b7280',
  },
  shareLabel: {
    fontSize: 13,
    color: '#374151',
    marginTop: 6,
  },
  shareStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  statText: {
    fontSize: 12,
    color: '#9ca3af',
  },
  statDot: {
    fontSize: 12,
    color: '#d1d5db',
    marginHorizontal: 2,
  },
  revokeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: '#fef2f2',
  },
  revokeButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#dc2626',
  },
});

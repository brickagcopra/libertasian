import { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  useSharedContent,
  useAccessSharedContentWithPassword,
} from '../../features/workspace/hooks/use-shares';
import type {
  SharedContentResponse,
  SharedMatterData,
  SharedMatterDocument,
  SharedMatterNote,
  SharedMatterTask,
} from '../../features/workspace/types';

type MatterTab = 'documents' | 'notes' | 'tasks' | 'details';

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  active: { bg: '#ecfdf5', text: '#059669' },
  closed: { bg: '#f3f4f6', text: '#6b7280' },
  archived: { bg: '#fef3c7', text: '#d97706' },
};

const PRIORITY_COLORS: Record<string, string> = {
  low: '#6b7280',
  medium: '#2563eb',
  high: '#d97706',
  urgent: '#dc2626',
};

const TASK_STATUS_ICONS: Record<string, { name: string; color: string }> = {
  todo: { name: 'ellipse-outline', color: '#9ca3af' },
  in_progress: { name: 'time-outline', color: '#2563eb' },
  done: { name: 'checkmark-circle', color: '#16a34a' },
  cancelled: { name: 'close-circle-outline', color: '#dc2626' },
};

export default function SharedContentScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const [password, setPassword] = useState('');
  const [submittedPassword, setSubmittedPassword] = useState<string | undefined>();
  const [activeTab, setActiveTab] = useState<MatterTab>('documents');

  const { data, isLoading, error } = useSharedContent(token ?? null, submittedPassword);
  const submitPassword = useAccessSharedContentWithPassword();

  const content: SharedContentResponse | undefined = data?.data ?? submitPassword.data?.data;

  const handleSubmitPassword = useCallback(async () => {
    if (!token || password.length === 0) return;
    try {
      const result = await submitPassword.mutateAsync({ token, password });
      if (result.data && !result.data.requiresPassword) {
        setSubmittedPassword(password);
      }
    } catch {
      // Error shown via submitPassword.error
    }
  }, [token, password, submitPassword]);

  // Loading state
  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Shared Content' }} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#1a56db" />
          <Text style={styles.loadingText}>Loading shared content...</Text>
        </View>
      </>
    );
  }

  // Error state
  if (error || submitPassword.error) {
    const errMsg =
      (error as Error)?.message ??
      (submitPassword.error as Error)?.message ??
      'Failed to load shared content';
    return (
      <>
        <Stack.Screen options={{ title: 'Shared Content' }} />
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color="#dc2626" />
          <Text style={styles.errorTitle}>Unable to Access</Text>
          <Text style={styles.errorMessage}>{errMsg}</Text>
        </View>
      </>
    );
  }

  // Password required
  if (content?.requiresPassword && !content.data) {
    return (
      <>
        <Stack.Screen options={{ title: 'Password Required' }} />
        <View style={styles.centered}>
          <View style={styles.passwordCard}>
            <Ionicons name="lock-closed-outline" size={40} color="#1a56db" />
            <Text style={styles.passwordTitle}>Password Protected</Text>
            <Text style={styles.passwordSubtitle}>
              This shared content requires a password to access.
            </Text>
            <TextInput
              style={styles.passwordInput}
              value={password}
              onChangeText={setPassword}
              placeholder="Enter password"
              placeholderTextColor="#9ca3af"
              secureTextEntry
              onSubmitEditing={handleSubmitPassword}
              returnKeyType="go"
            />
            {submitPassword.error ? (
              <Text style={styles.passwordError}>
                {(submitPassword.error as Error).message ?? 'Invalid password'}
              </Text>
            ) : null}
            <TouchableOpacity
              style={[
                styles.passwordButton,
                (password.length === 0 || submitPassword.isPending) && styles.disabledButton,
              ]}
              onPress={handleSubmitPassword}
              disabled={password.length === 0 || submitPassword.isPending}
            >
              {submitPassword.isPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.passwordButtonText}>Access Content</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </>
    );
  }

  // No content
  if (!content?.data) {
    return (
      <>
        <Stack.Screen options={{ title: 'Shared Content' }} />
        <View style={styles.centered}>
          <Ionicons name="document-outline" size={48} color="#d1d5db" />
          <Text style={styles.errorTitle}>No Content</Text>
          <Text style={styles.errorMessage}>This share link may have expired or been revoked.</Text>
        </View>
      </>
    );
  }

  const matter = content.data;
  const permissionLabel = content.permission ?? 'view';

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Shared Matter',
          headerRight: () => (
            <View style={styles.permBadgeHeader}>
              <Ionicons name="eye-outline" size={14} color="#1a56db" />
              <Text style={styles.permBadgeHeaderText}>{permissionLabel}</Text>
            </View>
          ),
        }}
      />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.sharedBanner}>
            <Ionicons name="link-outline" size={14} color="#1d4ed8" />
            <Text style={styles.sharedBannerText}>Shared via LIBERTASIAN</Text>
          </View>
          {content.label ? (
            <Text style={styles.sharedLabel}>{content.label}</Text>
          ) : null}
          <MatterHeader matter={matter} />
        </View>

        {/* Tabs */}
        <View style={styles.tabBar}>
          {(
            [
              { key: 'documents', label: 'Documents', count: matter._count.documents },
              { key: 'notes', label: 'Notes', count: matter._count.notes },
              { key: 'tasks', label: 'Tasks', count: matter._count.tasks },
              { key: 'details', label: 'Details', count: undefined },
            ] as const
          ).map((tab) => (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tab, activeTab === tab.key && styles.tabActive]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
                {tab.label}
                {tab.count !== undefined ? ` (${tab.count})` : ''}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Tab Content */}
        <View style={styles.tabContent}>
          {activeTab === 'documents' && <SharedDocumentsTab documents={matter.documents} />}
          {activeTab === 'notes' && <SharedNotesTab notes={matter.notes} />}
          {activeTab === 'tasks' && <SharedTasksTab tasks={matter.tasks} />}
          {activeTab === 'details' && <SharedDetailsTab matter={matter} />}
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </>
  );
}

// ─── Sub-Components ─────────────────────────────────────────

function MatterHeader({ matter }: { matter: SharedMatterData }) {
  const statusColor = STATUS_COLORS[matter.status] ?? STATUS_COLORS['active'];
  return (
    <View style={styles.matterHeader}>
      <View style={[styles.statusBadge, { backgroundColor: statusColor.bg }]}>
        <Text style={[styles.statusBadgeText, { color: statusColor.text }]}>
          {matter.status}
        </Text>
      </View>
      <Text style={styles.matterTitle}>{matter.title}</Text>
      {matter.court ? (
        <Text style={styles.matterMeta}>{matter.court}</Text>
      ) : null}
    </View>
  );
}

function SharedDocumentsTab({ documents }: { documents: SharedMatterDocument[] }) {
  if (documents.length === 0) {
    return (
      <View style={styles.emptyTab}>
        <Ionicons name="document-outline" size={36} color="#d1d5db" />
        <Text style={styles.emptyTabText}>No documents</Text>
      </View>
    );
  }

  return (
    <>
      {documents.map((doc) => (
        <View key={doc.id} style={styles.card}>
          <View style={styles.cardRow}>
            <Ionicons
              name={doc.legalDocument ? 'document-text-outline' : 'document-outline'}
              size={18}
              color={doc.legalDocument ? '#1a56db' : '#6b7280'}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {doc.title ?? doc.legalDocument?.title ?? 'Untitled'}
              </Text>
              <View style={styles.cardMetaRow}>
                <View style={styles.roleBadge}>
                  <Text style={styles.roleBadgeText}>{doc.role}</Text>
                </View>
                {doc.legalDocument?.citationText ? (
                  <Text style={styles.cardMetaText}>{doc.legalDocument.citationText}</Text>
                ) : null}
              </View>
            </View>
          </View>
        </View>
      ))}
    </>
  );
}

function SharedNotesTab({ notes }: { notes: SharedMatterNote[] }) {
  if (notes.length === 0) {
    return (
      <View style={styles.emptyTab}>
        <Ionicons name="create-outline" size={36} color="#d1d5db" />
        <Text style={styles.emptyTabText}>No notes</Text>
      </View>
    );
  }

  return (
    <>
      {notes.map((note) => (
        <View key={note.id} style={styles.card}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {note.title ?? 'Untitled Note'}
          </Text>
          <Text style={styles.cardMetaText}>
            {new Date(note.updatedAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </Text>
        </View>
      ))}
    </>
  );
}

function SharedTasksTab({ tasks }: { tasks: SharedMatterTask[] }) {
  if (tasks.length === 0) {
    return (
      <View style={styles.emptyTab}>
        <Ionicons name="checkbox-outline" size={36} color="#d1d5db" />
        <Text style={styles.emptyTabText}>No tasks</Text>
      </View>
    );
  }

  return (
    <>
      {tasks.map((task) => {
        const statusIcon = TASK_STATUS_ICONS[task.status] ?? TASK_STATUS_ICONS['todo'];
        const priorityColor = PRIORITY_COLORS[task.priority] ?? PRIORITY_COLORS['medium'];
        return (
          <View key={task.id} style={styles.card}>
            <View style={styles.cardRow}>
              <Ionicons
                name={statusIcon.name as keyof typeof Ionicons.glyphMap}
                size={20}
                color={statusIcon.color}
              />
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.cardTitle,
                    task.status === 'done' && styles.doneText,
                  ]}
                  numberOfLines={2}
                >
                  {task.title}
                </Text>
                <View style={styles.cardMetaRow}>
                  <View style={[styles.priorityDot, { backgroundColor: priorityColor }]} />
                  <Text style={styles.cardMetaText}>{task.priority}</Text>
                  {task.dueDate ? (
                    <Text style={styles.cardMetaText}>
                      Due{' '}
                      {new Date(task.dueDate).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </Text>
                  ) : null}
                  {task.assignedTo ? (
                    <Text style={styles.cardMetaText}>{task.assignedTo.fullName}</Text>
                  ) : null}
                </View>
              </View>
            </View>
          </View>
        );
      })}
    </>
  );
}

function SharedDetailsTab({ matter }: { matter: SharedMatterData }) {
  return (
    <>
      {matter.description ? (
        <View style={styles.detailSection}>
          <Text style={styles.detailLabel}>Description</Text>
          <Text style={styles.detailValue}>{matter.description}</Text>
        </View>
      ) : null}

      {matter.matterType ? (
        <View style={styles.detailSection}>
          <Text style={styles.detailLabel}>Type</Text>
          <Text style={styles.detailValue}>{matter.matterType.replace(/_/g, ' ')}</Text>
        </View>
      ) : null}

      {matter.court ? (
        <View style={styles.detailSection}>
          <Text style={styles.detailLabel}>Court</Text>
          <Text style={styles.detailValue}>{matter.court}</Text>
        </View>
      ) : null}

      <View style={styles.detailSection}>
        <Text style={styles.detailLabel}>Owner</Text>
        <Text style={styles.detailValue}>{matter.owner.fullName}</Text>
      </View>

      <View style={styles.detailSection}>
        <Text style={styles.detailLabel}>Created</Text>
        <Text style={styles.detailValue}>
          {new Date(matter.createdAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </Text>
      </View>
    </>
  );
}

// ─── Styles ─────────────────────────────────────────────────

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f4f6',
    padding: 24,
  },
  loadingText: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 12,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginTop: 12,
  },
  errorMessage: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 20,
  },

  // Password
  passwordCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    width: '100%',
    maxWidth: 360,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  passwordTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginTop: 12,
  },
  passwordSubtitle: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 16,
    lineHeight: 20,
  },
  passwordInput: {
    width: '100%',
    backgroundColor: '#f9fafb',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111827',
    textAlign: 'center',
  },
  passwordError: {
    fontSize: 13,
    color: '#dc2626',
    marginTop: 8,
  },
  passwordButton: {
    width: '100%',
    backgroundColor: '#1a56db',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 14,
  },
  passwordButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  disabledButton: {
    opacity: 0.5,
  },

  // Content
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  scrollContent: { paddingBottom: 24 },

  header: {
    backgroundColor: '#fff',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  sharedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#eff6ff',
    alignSelf: 'flex-start',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 8,
  },
  sharedBannerText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1d4ed8',
  },
  sharedLabel: {
    fontSize: 13,
    color: '#6b7280',
    fontStyle: 'italic',
    marginBottom: 4,
  },
  matterHeader: {},
  matterTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginTop: 6,
    lineHeight: 26,
  },
  matterMeta: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 4,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },

  permBadgeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#eff6ff',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  permBadgeHeaderText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1a56db',
    textTransform: 'capitalize',
  },

  // Tabs
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#1a56db',
  },
  tabText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#6b7280',
  },
  tabTextActive: {
    color: '#1a56db',
    fontWeight: '600',
  },
  tabContent: { padding: 12, gap: 8 },

  // Cards
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    lineHeight: 19,
    marginBottom: 4,
  },
  doneText: {
    textDecorationLine: 'line-through',
    color: '#9ca3af',
  },
  cardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardMetaText: {
    fontSize: 12,
    color: '#6b7280',
  },
  roleBadge: {
    backgroundColor: '#eff6ff',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#1d4ed8',
    textTransform: 'capitalize',
  },
  priorityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },

  // Empty
  emptyTab: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyTabText: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 8,
  },

  // Details
  detailSection: { marginBottom: 16 },
  detailLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailValue: {
    fontSize: 15,
    color: '#111827',
    lineHeight: 21,
  },
});

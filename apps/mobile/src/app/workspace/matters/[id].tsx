import { useCallback, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  useMatter,
  useDeleteMatter,
  useUpdateMatter,
  useRemoveMatterDocument,
} from '../../../features/workspace/hooks/use-matters';
import {
  useMatterComments,
  useCreateMatterComment,
  useDeleteMatterComment,
} from '../../../features/workspace/hooks/use-matter-comments';
import { ShareSheet } from '../../../features/workspace/components/share-sheet';
import type {
  MatterDetail,
  MatterDocument,
  MatterComment,
  MatterStatus,
} from '../../../features/workspace/types';
import type { NoteListItem } from '../../../features/workspace/types';

type Tab = 'documents' | 'notes' | 'comments' | 'details';

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  active: { bg: '#ecfdf5', text: '#059669' },
  closed: { bg: '#f3f4f6', text: '#6b7280' },
  archived: { bg: '#fef3c7', text: '#d97706' },
};

// ─── Documents Tab ─────────────────────────────────────────

function DocumentCard({
  doc,
  onRemove,
}: {
  doc: MatterDocument;
  onRemove: () => void;
}) {
  const title =
    doc.title ??
    doc.legalDocument?.title ??
    doc.userUpload?.originalFilename ??
    'Untitled';

  const isLegal = !!doc.legalDocumentId;

  return (
    <View style={styles.docCard}>
      <View style={styles.docRow}>
        <Ionicons
          name={isLegal ? 'document-text-outline' : 'cloud-upload-outline'}
          size={18}
          color={isLegal ? '#1a56db' : '#6b7280'}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.docTitle} numberOfLines={2}>
            {title}
          </Text>
          <View style={styles.docMeta}>
            <View style={styles.roleBadge}>
              <Text style={styles.roleBadgeText}>{doc.role}</Text>
            </View>
            {doc.legalDocument?.citationText ? (
              <Text style={styles.docMetaText}>
                {doc.legalDocument.citationText}
              </Text>
            ) : null}
          </View>
        </View>
        <TouchableOpacity
          onPress={onRemove}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="close-circle-outline" size={20} color="#9ca3af" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function DocumentsTab({
  matter,
  onRemoveDoc,
}: {
  matter: MatterDetail;
  onRemoveDoc: (docId: string) => void;
}) {
  return (
    <View style={styles.tabContent}>
      <TouchableOpacity
        style={styles.addDocButton}
        onPress={() =>
          router.push({
            pathname: '/workspace/matters/add-document',
            params: { matterId: matter.id },
          })
        }
        activeOpacity={0.7}
      >
        <Ionicons name="add-circle-outline" size={18} color="#1a56db" />
        <Text style={styles.addDocButtonText}>Add Document</Text>
      </TouchableOpacity>
      {matter.documents.length === 0 ? (
        <View style={styles.emptyTab}>
          <Ionicons name="document-outline" size={36} color="#d1d5db" />
          <Text style={styles.emptyTabText}>No documents attached</Text>
        </View>
      ) : (
        matter.documents.map((doc) => (
          <DocumentCard
            key={doc.id}
            doc={doc}
            onRemove={() => onRemoveDoc(doc.id)}
          />
        ))
      )}
    </View>
  );
}

// ─── Notes Tab ─────────────────────────────────────────────

function NoteCard({ note }: { note: NoteListItem }) {
  return (
    <TouchableOpacity
      style={styles.noteCard}
      onPress={() => router.push(`/workspace/notes/${note.id}`)}
      activeOpacity={0.7}
    >
      <Text style={styles.noteTitle} numberOfLines={1}>
        {note.title ?? 'Untitled Note'}
      </Text>
      <View style={styles.noteFooter}>
        <Text style={styles.noteAuthor}>{note.user.fullName}</Text>
        <Text style={styles.noteDate}>
          {new Date(note.updatedAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function NotesTab({ matter }: { matter: MatterDetail }) {
  if (matter.notes.length === 0) {
    return (
      <View style={styles.emptyTab}>
        <Ionicons name="create-outline" size={36} color="#d1d5db" />
        <Text style={styles.emptyTabText}>No notes yet</Text>
      </View>
    );
  }

  return (
    <View style={styles.tabContent}>
      {matter.notes.map((note) => (
        <NoteCard key={note.id} note={note} />
      ))}
    </View>
  );
}

// ─── Comments Tab ──────────────────────────────────────────

function CommentsTab({ matterId }: { matterId: string }) {
  const { data: commentsData, isLoading } = useMatterComments(matterId);
  const createComment = useCreateMatterComment();
  const deleteComment = useDeleteMatterComment();
  const [body, setBody] = useState('');

  const comments = commentsData?.data;

  const handleSubmit = useCallback(async () => {
    const trimmed = body.trim();
    if (!trimmed) return;

    try {
      await createComment.mutateAsync({ matterId, body: trimmed });
      setBody('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to post';
      Alert.alert('Error', message);
    }
  }, [body, matterId, createComment]);

  const handleDelete = useCallback(
    (comment: MatterComment) => {
      Alert.alert('Delete Comment', 'Are you sure?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            deleteComment.mutate({ matterId, commentId: comment.id }),
        },
      ]);
    },
    [matterId, deleteComment],
  );

  return (
    <View style={styles.tabContent}>
      {/* Input */}
      <View style={styles.commentInputContainer}>
        <TextInput
          style={styles.commentInput}
          value={body}
          onChangeText={setBody}
          placeholder="Add a comment..."
          multiline
          maxLength={5000}
        />
        <View style={styles.commentInputFooter}>
          <Text style={styles.commentCharCount}>{body.length}/5000</Text>
          <TouchableOpacity
            style={[
              styles.commentSubmitBtn,
              (!body.trim() || createComment.isPending) &&
                styles.commentSubmitBtnDisabled,
            ]}
            onPress={handleSubmit}
            disabled={!body.trim() || createComment.isPending}
          >
            <Text style={styles.commentSubmitBtnText}>
              {createComment.isPending ? 'Posting...' : 'Post'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* List */}
      {isLoading ? (
        <View style={styles.emptyTab}>
          <ActivityIndicator size="small" color="#1a56db" />
        </View>
      ) : !comments || comments.length === 0 ? (
        <View style={styles.emptyTab}>
          <Ionicons name="chatbubble-outline" size={36} color="#d1d5db" />
          <Text style={styles.emptyTabText}>No comments yet</Text>
        </View>
      ) : (
        comments.map((comment) => (
          <View key={comment.id} style={styles.commentCard}>
            <View style={styles.commentHeader}>
              <Text style={styles.commentAuthor}>
                {comment.user.fullName}
              </Text>
              <Text style={styles.commentDate}>
                {new Date(comment.createdAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </Text>
            </View>
            <Text style={styles.commentBody}>{comment.body}</Text>
            <TouchableOpacity
              style={styles.commentDeleteBtn}
              onPress={() => handleDelete(comment)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="trash-outline" size={14} color="#9ca3af" />
            </TouchableOpacity>
          </View>
        ))
      )}
    </View>
  );
}

// ─── Details Tab ───────────────────────────────────────────

function DetailsTab({
  matter,
  onStatusChange,
}: {
  matter: MatterDetail;
  onStatusChange: (status: MatterStatus) => void;
}) {
  const statusColor = STATUS_COLORS[matter.status] ?? STATUS_COLORS['active'];

  return (
    <View style={styles.tabContent}>
      <View style={styles.detailSection}>
        <Text style={styles.detailLabel}>Status</Text>
        <View style={styles.statusRow}>
          {(['active', 'closed', 'archived'] as MatterStatus[]).map((s) => {
            const c = STATUS_COLORS[s] ?? STATUS_COLORS['active'];
            const isSelected = matter.status === s;
            return (
              <TouchableOpacity
                key={s}
                style={[
                  styles.statusChip,
                  isSelected && { backgroundColor: c.bg, borderColor: c.text },
                ]}
                onPress={() => {
                  if (!isSelected) onStatusChange(s);
                }}
              >
                <Text
                  style={[
                    styles.statusChipText,
                    isSelected && { color: c.text, fontWeight: '600' },
                  ]}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {matter.description ? (
        <View style={styles.detailSection}>
          <Text style={styles.detailLabel}>Description</Text>
          <Text style={styles.detailValue}>{matter.description}</Text>
        </View>
      ) : null}

      {matter.matterType ? (
        <View style={styles.detailSection}>
          <Text style={styles.detailLabel}>Type</Text>
          <View style={styles.typeBadgeLarge}>
            <Text style={styles.typeBadgeLargeText}>
              {matter.matterType.replace(/_/g, ' ')}
            </Text>
          </View>
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
    </View>
  );
}

// ─── Main Screen ───────────────────────────────────────────

export default function MatterDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<Tab>('documents');
  const [shareVisible, setShareVisible] = useState(false);

  const { data, isLoading, refetch } = useMatter(id ?? null);
  const deleteMatter = useDeleteMatter();
  const updateMatter = useUpdateMatter();
  const removeDoc = useRemoveMatterDocument();

  const matter = data?.data;

  const handleDelete = useCallback(() => {
    Alert.alert(
      'Delete Matter',
      'This action cannot be undone. All documents and notes will be removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteMatter.mutateAsync(id ?? '');
              router.back();
            } catch (err) {
              const message =
                err instanceof Error ? err.message : 'Failed to delete';
              Alert.alert('Error', message);
            }
          },
        },
      ],
    );
  }, [id, deleteMatter]);

  const handleRemoveDoc = useCallback(
    (docId: string) => {
      Alert.alert('Remove Document', 'Remove this document from the matter?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            if (id) removeDoc.mutate({ matterId: id, docId });
          },
        },
      ]);
    },
    [id, removeDoc],
  );

  const handleStatusChange = useCallback(
    (status: MatterStatus) => {
      if (id) updateMatter.mutate({ id, status });
    },
    [id, updateMatter],
  );

  if (isLoading || !matter) {
    return (
      <>
        <Stack.Screen options={{ title: 'Matter' }} />
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color="#1a56db" />
        </View>
      </>
    );
  }

  const statusColor = STATUS_COLORS[matter.status] ?? STATUS_COLORS['active'];

  return (
    <>
      <Stack.Screen
        options={{
          title: '',
          headerRight: () => (
            <View style={styles.headerActions}>
              <TouchableOpacity
                onPress={() => setShareVisible(true)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="share-outline" size={20} color="#1a56db" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleDelete}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="trash-outline" size={20} color="#dc2626" />
              </TouchableOpacity>
            </View>
          ),
        }}
      />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={() => refetch()}
            colors={['#1a56db']}
          />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={[styles.statusBadge, { backgroundColor: statusColor.bg }]}>
            <Text style={[styles.statusBadgeText, { color: statusColor.text }]}>
              {matter.status}
            </Text>
          </View>
          <Text style={styles.headerTitle}>{matter.title}</Text>
          {matter.court ? (
            <Text style={styles.headerMeta}>{matter.court}</Text>
          ) : null}
        </View>

        {/* Tabs */}
        <View style={styles.tabBar}>
          {(
            [
              { key: 'documents', label: 'Documents', count: matter.documents.length },
              { key: 'notes', label: 'Notes', count: matter.notes.length },
              { key: 'comments', label: 'Comments', count: undefined },
              { key: 'details', label: 'Details', count: undefined },
            ] as const
          ).map((tab) => (
            <TouchableOpacity
              key={tab.key}
              style={[
                styles.tab,
                activeTab === tab.key && styles.tabActive,
              ]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === tab.key && styles.tabTextActive,
                ]}
              >
                {tab.label}
                {tab.count !== undefined ? ` (${tab.count})` : ''}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Tab Content */}
        {activeTab === 'documents' && (
          <DocumentsTab matter={matter} onRemoveDoc={handleRemoveDoc} />
        )}
        {activeTab === 'notes' && <NotesTab matter={matter} />}
        {activeTab === 'comments' && <CommentsTab matterId={matter.id} />}
        {activeTab === 'details' && (
          <DetailsTab matter={matter} onStatusChange={handleStatusChange} />
        )}

        <View style={{ height: 24 }} />
      </ScrollView>

      {/* Share Sheet */}
      {id ? (
        <ShareSheet
          visible={shareVisible}
          onClose={() => setShareVisible(false)}
          entityType="matter"
          entityId={id}
          entityTitle={matter.title}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  scrollContent: { paddingBottom: 24 },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },

  // Header
  header: {
    backgroundColor: '#fff',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginTop: 8,
    lineHeight: 26,
  },
  headerMeta: {
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

  // Tab Bar
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
    fontSize: 13,
    fontWeight: '500',
    color: '#6b7280',
  },
  tabTextActive: {
    color: '#1a56db',
    fontWeight: '600',
  },

  // Tab Content
  tabContent: { padding: 12, gap: 8 },
  addDocButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#eff6ff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderStyle: 'dashed',
    paddingVertical: 10,
  },
  addDocButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a56db',
  },
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

  // Document Card
  docCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  docRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  docTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    lineHeight: 19,
    marginBottom: 4,
  },
  docMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  docMetaText: { fontSize: 12, color: '#6b7280' },
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

  // Note Card
  noteCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  noteTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 6,
  },
  noteFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  noteAuthor: { fontSize: 12, color: '#6b7280' },
  noteDate: { fontSize: 12, color: '#9ca3af' },

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
  statusRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  statusChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  statusChipText: {
    fontSize: 13,
    color: '#6b7280',
  },
  typeBadgeLarge: {
    alignSelf: 'flex-start',
    backgroundColor: '#eff6ff',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 2,
  },
  typeBadgeLargeText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1d4ed8',
    textTransform: 'capitalize',
  },

  // Comment styles
  commentInputContainer: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  commentInputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  commentInput: {
    fontSize: 14,
    color: '#111827',
    minHeight: 60,
    textAlignVertical: 'top',
  },
  commentInputFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  commentCharCount: {
    fontSize: 11,
    color: '#9ca3af',
  },
  commentSubmitBtn: {
    backgroundColor: '#1a56db',
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  commentSubmitBtnDisabled: {
    opacity: 0.5,
  },
  commentSubmitBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  commentCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  commentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  commentAuthor: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
  },
  commentDate: {
    fontSize: 11,
    color: '#9ca3af',
  },
  commentBody: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
  },
  commentDeleteBtn: {
    alignSelf: 'flex-end',
    marginTop: 4,
  },
});

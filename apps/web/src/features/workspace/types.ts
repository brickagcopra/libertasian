// ============================================================================
// Workspace Types — Matters, Notes, Annotations, Matter Documents
// ============================================================================

// -- Matters ------------------------------------------------------------------

export type MatterStatus = 'active' | 'closed' | 'archived';
export type MatterType = 'civil' | 'criminal' | 'labor' | 'commercial' | 'tax' | 'admin' | 'other';
export type MatterDocumentRole = 'evidence' | 'reference' | 'pleading' | 'research' | 'note';

export interface MatterOwner {
  id: string;
  fullName: string;
  email: string;
}

export interface MatterListItem {
  id: string;
  title: string;
  description: string | null;
  matterType: string | null;
  court: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  owner: MatterOwner;
  _count: {
    documents: number;
    notes: number;
  };
}

export interface MatterDocumentLegalDoc {
  id: string;
  title: string;
  shortTitle: string | null;
  citationText: string | null;
  documentType?: string;
}

export interface MatterDocumentUpload {
  id: string;
  originalFilename: string | null;
  uploadType: string;
  mimeType?: string | null;
}

export interface MatterDocument {
  id: string;
  matterId: string;
  title: string | null;
  role: string;
  createdAt: string;
  legalDocument: MatterDocumentLegalDoc | null;
  userUpload: MatterDocumentUpload | null;
}

export interface NoteListItem {
  id: string;
  title: string | null;
  visibility: string;
  createdAt: string;
  updatedAt: string;
}

export interface MatterDetail extends MatterListItem {
  documents: MatterDocument[];
  notes: NoteListItem[];
}

export interface MatterListMeta {
  hasNext: boolean;
  nextCursor?: string;
  limit: number;
}

export interface MatterListResponse {
  success: boolean;
  data: MatterListItem[];
  meta: MatterListMeta;
}

export interface MatterDetailResponse {
  success: boolean;
  data: MatterDetail;
}

// -- Notes --------------------------------------------------------------------

export type NoteVisibility = 'private' | 'org';

export interface NoteAuthor {
  id: string;
  fullName: string;
}

export interface NoteMatter {
  id: string;
  title: string;
}

export interface Note {
  id: string;
  title: string | null;
  body: Record<string, unknown>;
  visibility: string;
  createdAt: string;
  updatedAt: string;
  user: NoteAuthor;
  matter: NoteMatter | null;
}

export interface NoteListMeta {
  hasNext: boolean;
  nextCursor?: string;
  limit: number;
}

export interface NoteListResponse {
  success: boolean;
  data: Note[];
  meta: NoteListMeta;
}

export interface NoteDetailResponse {
  success: boolean;
  data: Note;
}

// -- Annotations --------------------------------------------------------------

export type AnnotationColor = 'yellow' | 'green' | 'blue' | 'red' | 'purple';

export interface TextAnchor {
  startOffset: number;
  endOffset: number;
  anchorText: string;
}

export interface AnnotationDocument {
  id: string;
  title: string;
  shortTitle: string | null;
  citationText: string | null;
}

export interface AnnotationSection {
  id: string;
  sectionType: string;
  sectionLabel: string | null;
}

export interface Annotation {
  id: string;
  legalDocumentId: string;
  sectionId: string | null;
  textAnchor: TextAnchor;
  annotationText: string | null;
  color: string;
  createdAt: string;
  legalDocument: AnnotationDocument;
  section: AnnotationSection | null;
}

export interface AnnotationListResponse {
  success: boolean;
  data: Annotation[];
}

// -- Create/Update DTOs -------------------------------------------------------

export interface CreateMatterInput {
  title: string;
  description?: string;
  matterType?: string;
  court?: string;
}

export interface UpdateMatterInput {
  title?: string;
  description?: string;
  matterType?: string;
  court?: string;
  status?: MatterStatus;
}

export interface AddMatterDocumentInput {
  legalDocumentId?: string;
  userUploadId?: string;
  title?: string;
  role?: MatterDocumentRole;
}

export interface CreateNoteInput {
  title?: string;
  body: Record<string, unknown>;
  matterId?: string;
  visibility?: NoteVisibility;
}

export interface UpdateNoteInput {
  title?: string;
  body?: Record<string, unknown>;
  matterId?: string | null;
  visibility?: NoteVisibility;
}

export interface CreateAnnotationInput {
  legalDocumentId: string;
  sectionId?: string;
  textAnchor: TextAnchor;
  annotationText?: string;
  color?: AnnotationColor;
}

// -- Tasks --------------------------------------------------------------------

export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface TaskUser {
  id: string;
  fullName: string;
  email?: string;
}

export interface TaskMatter {
  id: string;
  title: string;
}

export interface TaskListItem {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: TaskUser;
  assignedTo: TaskUser | null;
  matter: TaskMatter | null;
  _count: {
    comments: number;
  };
}

export interface TaskComment {
  id: string;
  taskId: string;
  body: string;
  createdAt: string;
  user: TaskUser;
}

export interface TaskDetail extends TaskListItem {
  comments: TaskComment[];
}

export interface TaskListMeta {
  hasNext: boolean;
  nextCursor?: string;
  limit: number;
}

export interface TaskListResponse {
  success: boolean;
  data: TaskListItem[];
  meta: TaskListMeta;
}

export interface TaskDetailResponse {
  success: boolean;
  data: TaskDetail;
}

export interface TaskCommentListResponse {
  success: boolean;
  data: TaskComment[];
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  matterId?: string;
  assignedToUserId?: string;
  priority?: TaskPriority;
  dueDate?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  matterId?: string | null;
  assignedToUserId?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
}

export interface CreateTaskCommentInput {
  body: string;
}

// -- Activity Feed ------------------------------------------------------------

export interface ActivityEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorType: string;
  actor: { id: string; fullName: string } | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface ActivityListResponse {
  success: boolean;
  data: ActivityEntry[];
  meta: {
    hasNext: boolean;
    nextCursor?: string;
    limit: number;
  };
}

// -- Workspace Sharing --------------------------------------------------------

export type SharePermission = 'view' | 'comment' | 'edit';
export type ShareEntityType = 'matter';

export interface ShareListItem {
  id: string;
  entityType: string;
  entityId: string;
  permission: string;
  label: string | null;
  isActive: boolean;
  isPasswordProtected: boolean;
  expiresAt: string | null;
  lastAccessedAt: string | null;
  accessCount: number;
  createdBy: { id: string; fullName: string };
  createdAt: string;
}

export interface ShareCreateResult {
  share: ShareListItem;
  token: string;
}

export interface ShareListResponse {
  success: boolean;
  data: ShareListItem[];
}

export interface CreateShareInput {
  entityType: ShareEntityType;
  entityId: string;
  permission?: SharePermission;
  password?: string;
  label?: string;
  expiresAt?: string;
}

export interface UpdateShareInput {
  permission?: SharePermission;
  label?: string;
  password?: string;
  expiresAt?: string | null;
  isActive?: boolean;
}

export interface SharedContentResponse {
  requiresPassword: boolean;
  entityType?: string;
  permission?: string;
  label?: string | null;
  data?: SharedMatterData;
}

export interface SharedMatterData {
  id: string;
  title: string;
  description: string | null;
  matterType: string | null;
  court: string | null;
  status: string;
  owner: { id: string; fullName: string };
  documents: SharedMatterDocument[];
  notes: SharedMatterNote[];
  tasks: SharedMatterTask[];
  _count: { documents: number; notes: number; tasks: number };
  createdAt: string;
  updatedAt: string;
}

export interface SharedMatterDocument {
  id: string;
  title: string | null;
  role: string;
  legalDocument: {
    id: string;
    title: string;
    shortTitle: string | null;
    citationText: string | null;
    documentType: string;
  } | null;
  createdAt: string;
}

export interface SharedMatterNote {
  id: string;
  title: string | null;
  visibility: string;
  createdAt: string;
  updatedAt: string;
  body?: unknown;
}

export interface SharedMatterTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  assignedTo: { id: string; fullName: string } | null;
}

// -- Matter Comments ----------------------------------------------------------

export interface MatterComment {
  id: string;
  matterId: string;
  body: string;
  createdAt: string;
  user: TaskUser;
}

export interface MatterCommentListResponse {
  success: boolean;
  data: MatterComment[];
}

export interface CreateMatterCommentInput {
  body: string;
}

// -- Notifications ------------------------------------------------------------

export interface NotificationItem {
  id: string;
  userId: string;
  organizationId: string | null;
  type: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListResponse {
  success: boolean;
  data: NotificationItem[];
  meta: {
    hasNext: boolean;
    nextCursor?: string;
    limit: number;
  };
}

export interface UnreadCountResponse {
  success: boolean;
  data: { count: number };
}

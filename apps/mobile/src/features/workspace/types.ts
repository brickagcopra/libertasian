// ─── Pagination ────────────────────────────────────────────
export interface PaginationMeta {
  hasNext: boolean;
  nextCursor?: string;
  limit: number;
}

// ─── Matters ───────────────────────────────────────────────
export type MatterStatus = 'active' | 'closed' | 'archived';
export type MatterType =
  | 'civil'
  | 'criminal'
  | 'labor'
  | 'commercial'
  | 'administrative'
  | 'special_proceedings'
  | 'other';

export interface MatterListItem {
  id: string;
  organizationId: string;
  ownerUserId: string;
  title: string;
  description: string | null;
  matterType: string | null;
  court: string | null;
  status: MatterStatus;
  createdAt: string;
  updatedAt: string;
  owner: { id: string; fullName: string; email: string };
  _count: { documents: number; notes: number };
}

export interface MatterDocument {
  id: string;
  matterId: string;
  legalDocumentId: string | null;
  userUploadId: string | null;
  title: string | null;
  role: string;
  createdAt: string;
  legalDocument?: {
    id: string;
    title: string;
    shortTitle: string | null;
    citationText: string | null;
  };
  userUpload?: {
    id: string;
    originalFilename: string;
    uploadType: string;
    mimeType: string | null;
  };
}

export interface MatterDetail extends MatterListItem {
  documents: MatterDocument[];
  notes: NoteListItem[];
}

export interface MatterListResponse {
  success: boolean;
  data: MatterListItem[];
  meta: PaginationMeta;
}

export interface MatterDetailResponse {
  success: boolean;
  data: MatterDetail;
}

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

export interface MatterFilters {
  cursor?: string;
  limit?: number;
  status?: MatterStatus;
  search?: string;
}

// ─── Notes ─────────────────────────────────────────────────
export type NoteVisibility = 'private' | 'org';

export interface NoteListItem {
  id: string;
  organizationId: string;
  userId: string;
  matterId: string | null;
  title: string | null;
  body: Record<string, unknown>;
  visibility: NoteVisibility;
  createdAt: string;
  updatedAt: string;
  user: { id: string; fullName: string };
  matter?: { id: string; title: string };
}

export interface NoteListResponse {
  success: boolean;
  data: NoteListItem[];
  meta: PaginationMeta;
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

export interface NoteFilters {
  cursor?: string;
  limit?: number;
  matterId?: string;
  visibility?: NoteVisibility;
  search?: string;
}

// ─── Tasks ─────────────────────────────────────────────────
export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface TaskListItem {
  id: string;
  organizationId: string;
  matterId: string | null;
  createdByUserId: string;
  assignedToUserId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; fullName: string; email: string };
  assignedTo: { id: string; fullName: string; email: string } | null;
  matter?: { id: string; title: string };
  _count: { comments: number };
}

export interface TaskComment {
  id: string;
  taskId: string;
  userId: string;
  body: string;
  createdAt: string;
  user: { id: string; fullName: string };
}

export interface TaskDetail extends TaskListItem {
  comments: TaskComment[];
}

export interface TaskListResponse {
  success: boolean;
  data: TaskListItem[];
  meta: PaginationMeta;
}

export interface TaskDetailResponse {
  success: boolean;
  data: TaskDetail;
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

export interface TaskFilters {
  cursor?: string;
  limit?: number;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignedToUserId?: string;
  matterId?: string;
  search?: string;
  dueBefore?: string;
  dueAfter?: string;
}

// ─── Activity ──────────────────────────────────────────────
export interface ActivityEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorType: string;
  actor?: { id: string; fullName: string };
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface ActivityListResponse {
  success: boolean;
  data: ActivityEntry[];
  meta: PaginationMeta;
}

export interface ActivityFilters {
  cursor?: string;
  limit?: number;
  entityType?: string;
  actorUserId?: string;
}

// ─── Workspace Sharing ────────────────────────────────────
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

// ─── Matter Comments ───────────────────────────────────────
export interface MatterComment {
  id: string;
  matterId: string;
  body: string;
  createdAt: string;
  user: { id: string; fullName: string };
}

export interface MatterCommentListResponse {
  success: boolean;
  data: MatterComment[];
}

export interface CreateMatterCommentInput {
  body: string;
}

// ─── Notifications ─────────────────────────────────────────
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

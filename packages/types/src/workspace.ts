/** Workspace sharing types per PDD Section 4.3 — capability-based sharing model */

export enum SharePermission {
  VIEW = 'view',
  COMMENT = 'comment',
  EDIT = 'edit',
}

export enum ShareEntityType {
  MATTER = 'matter',
}

export interface WorkspaceShareListItem {
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

export interface WorkspaceShareCreateResult {
  share: WorkspaceShareListItem;
  token: string;
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
  user: { id: string; fullName: string };
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

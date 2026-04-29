'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

// ---- Types matching the API response shape from documents.service.ts:list/findById/listSections ----

export type AdminDocumentStatus = 'draft' | 'published' | 'unpublished' | 'archived';

export type AdminDocumentType =
  | 'case'
  | 'statute'
  | 'rule'
  | 'issuance'
  | 'memorandum'
  | 'order'
  | 'digest'
  | 'reviewer'
  | 'user_private_doc';

export interface AdminDocumentListItem {
  id: string;
  documentType: string;
  title: string;
  shortTitle: string | null;
  citationText: string | null;
  grNo: string | null;
  decisionDate: string | null;
  ponente: string | null;
  court: string | null;
  status: string;
  isPublished: boolean;
  isOfficial: boolean;
  truthfulnessStatus: string | null;
  createdAt: string;
  source: { id: string; name: string } | null;
}

export interface AdminDocumentDetail {
  id: string;
  documentType: string;
  title: string;
  shortTitle: string | null;
  citationText: string | null;
  grNo: string | null;
  docketNo: string | null;
  promulgationDate: string | null;
  decisionDate: string | null;
  publicationDate: string | null;
  ponente: string | null;
  court: string | null;
  agency: string | null;
  jurisdiction: string | null;
  language: string | null;
  canonicalUrl: string | null;
  externalId: string | null;
  isPublished: boolean;
  isOfficial: boolean;
  status: string;
  truthfulnessStatus: string | null;
  confidenceScore: number | null;
  sourceId: string | null;
  createdAt: string;
  updatedAt: string;
  source:
    | { id: string; name: string; type: string; trustLevel: string }
    | null;
  _count?: {
    sections: number;
    citationsFrom: number;
    bookmarks: number;
    digests: number;
  };
}

export interface AdminDocumentSection {
  id: string;
  sectionType: string;
  sectionLabel: string | null;
  parentSectionId: string | null;
  ordering: number;
  plainText: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  tokenCount: number | null;
  createdAt: string;
}

export interface AdminDocumentListParams {
  status?: string;
  documentType?: string;
  court?: string;
  ponente?: string;
  sourceId?: string;
  grNo?: string;
  dateFrom?: string;
  dateTo?: string;
  cursor?: string;
  limit?: number;
}

// ---- List ----

export function useAdminDocuments(params?: AdminDocumentListParams) {
  return useQuery({
    queryKey: ['admin', 'documents', params],
    queryFn: async () => {
      const queryParams: Record<string, string> = {};
      if (params?.status) queryParams['status'] = params.status;
      if (params?.documentType) queryParams['documentType'] = params.documentType;
      if (params?.court) queryParams['court'] = params.court;
      if (params?.ponente) queryParams['ponente'] = params.ponente;
      if (params?.sourceId) queryParams['sourceId'] = params.sourceId;
      if (params?.grNo) queryParams['grNo'] = params.grNo;
      if (params?.dateFrom) queryParams['dateFrom'] = params.dateFrom;
      if (params?.dateTo) queryParams['dateTo'] = params.dateTo;
      if (params?.cursor) queryParams['cursor'] = params.cursor;
      if (params?.limit) queryParams['limit'] = String(params.limit);

      const res = await apiClient.get<{
        success: boolean;
        data: AdminDocumentListItem[];
        meta: { hasNext: boolean; nextCursor?: string; limit: number };
      }>('/documents', { params: queryParams });
      return { items: res.data, meta: res.meta };
    },
  });
}

// ---- Single document ----

export function useAdminDocument(id: string) {
  return useQuery({
    queryKey: ['admin', 'document', id],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: AdminDocumentDetail }>(
        `/documents/${id}`,
      );
      return res.data;
    },
    enabled: !!id,
  });
}

// ---- Sections ----

export function useAdminDocumentSections(id: string) {
  return useQuery({
    queryKey: ['admin', 'document', id, 'sections'],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: AdminDocumentSection[] }>(
        `/documents/${id}/sections`,
      );
      return res.data;
    },
    enabled: !!id,
  });
}

// ---- Publish ----

export function usePublishDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.post<{ success: boolean; data: AdminDocumentDetail }>(
        `/documents/${id}/publish`,
      );
      return res.data;
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'documents'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'document', id] });
    },
  });
}

// ---- Quarantine ----

export function useQuarantineDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.post<{ success: boolean; data: AdminDocumentDetail }>(
        `/documents/${id}/quarantine`,
      );
      return res.data;
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'documents'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'document', id] });
    },
  });
}

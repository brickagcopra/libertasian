import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { DoctrineListItem, DoctrineDetail } from '../types';

// ---- List Doctrines ----

interface DoctrineFilters {
  doctrineType?: string;
  reviewStatus?: string;
  cursor?: string;
}

export function useAdminDoctrines(filters: DoctrineFilters = {}) {
  const params: Record<string, string> = {};
  if (filters.doctrineType) params['doctrineType'] = filters.doctrineType;
  if (filters.reviewStatus) params['reviewStatus'] = filters.reviewStatus;
  if (filters.cursor) params['cursor'] = filters.cursor;

  return useQuery({
    queryKey: ['admin', 'doctrines', filters],
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: DoctrineListItem[];
        meta: { hasNext: boolean; nextCursor?: string; limit: number };
      }>('/admin/doctrines', { params });
      return { items: res.data, meta: res.meta };
    },
    staleTime: 2 * 60 * 1000,
  });
}

// ---- Doctrine Detail ----

export function useAdminDoctrineDetail(id: string) {
  return useQuery({
    queryKey: ['admin', 'doctrine', id],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: DoctrineDetail }>(
        `/admin/doctrines/${id}`,
      );
      return res.data;
    },
    enabled: id.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}

// ---- Approve Doctrine ----

export function useApproveDoctrine() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.post<{ success: boolean; data: DoctrineDetail }>(
        `/admin/doctrines/${id}/approve`,
      );
      return res.data;
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'doctrines'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'doctrine', id] });
    },
  });
}

// ---- Reject Doctrine ----

export function useRejectDoctrine() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.post<{ success: boolean; data: DoctrineDetail }>(
        `/admin/doctrines/${id}/reject`,
      );
      return res.data;
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'doctrines'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'doctrine', id] });
    },
  });
}

// ---- Extract Doctrines ----

interface ExtractDoctrinesInput {
  legalDocumentId: string;
  strategy?: string;
}

interface ExtractionResult {
  documentId: string;
  documentTitle: string;
  doctrinesExtracted: number;
  status: 'queued' | 'processing' | 'completed';
}

export function useExtractDoctrines() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ExtractDoctrinesInput) => {
      const res = await apiClient.post<{ success: boolean; data: ExtractionResult }>(
        '/admin/doctrines/extract',
        { documentId: input.legalDocumentId, strategy: input.strategy },
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'doctrines'] });
    },
  });
}

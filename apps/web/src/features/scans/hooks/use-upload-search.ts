'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export interface UploadSearchResult {
  total: number;
  page: number;
  limit: number;
  timedOut: boolean;
  items: {
    id: string;
    score: number;
    source: {
      upload_id: string;
      organization_id: string;
      user_id: string;
      original_filename?: string;
      classified_document_type?: string;
      upload_type: string;
      privacy_level: string;
      extracted_citations?: string[];
      created_at: string;
    };
    highlights?: Record<string, string[]>;
  }[];
}

interface UseUploadSearchParams {
  query: string;
  documentType?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}

export function useUploadSearch(params: UseUploadSearchParams | null) {
  return useQuery({
    queryKey: ['upload-search', params],
    queryFn: async () => {
      if (!params?.query) return null;
      const res = await apiClient.post<{ success: boolean; data: UploadSearchResult }>(
        '/uploads/search',
        params,
      );
      return res.data;
    },
    enabled: !!params?.query && params.query.length > 0,
  });
}

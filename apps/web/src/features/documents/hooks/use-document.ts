'use client';

import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

interface DocumentSection {
  id: string;
  sectionType: string;
  sectionLabel: string | null;
  plainText: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  ordering: number;
}

interface LegalDocument {
  id: string;
  title: string;
  shortTitle: string | null;
  citationText: string | null;
  documentType: string;
  court: string | null;
  ponente: string | null;
  jurisdiction: string | null;
  language: string | null;
  status: string;
  grNo: string | null;
  docketNo: string | null;
  isOfficial: boolean;
  isPublished: boolean;
  decisionDate: string | null;
  promulgationDate: string | null;
  publicationDate: string | null;
  createdAt: string;
}

export function useDocument(id: string) {
  return useQuery({
    queryKey: ['document', id],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: LegalDocument }>(
        `/documents/${id}`,
      );
      return res.data;
    },
    enabled: !!id,
  });
}

export function useDocumentSections(id: string) {
  return useQuery({
    queryKey: ['document-sections', id],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: DocumentSection[] }>(
        `/documents/${id}/sections`,
      );
      return res.data;
    },
    enabled: !!id,
  });
}

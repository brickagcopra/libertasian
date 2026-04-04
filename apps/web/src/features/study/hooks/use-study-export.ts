'use client';

import { useMutation } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { ExportFormat } from '../types';

export function useExportFlashcardSet() {
  return useMutation({
    mutationFn: async ({ id, format }: { id: string; format: ExportFormat }) => {
      await apiClient.download(`/study/flashcard-sets/${id}/export`, {
        params: { format },
      });
    },
  });
}

export function useExportReviewerPack() {
  return useMutation({
    mutationFn: async ({ id, format }: { id: string; format: ExportFormat }) => {
      await apiClient.download(`/study/reviewer-packs/${id}/export`, {
        params: { format },
      });
    },
  });
}

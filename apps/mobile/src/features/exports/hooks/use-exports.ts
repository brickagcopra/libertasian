import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';

import { apiClient } from '../../../lib/api-client';
import type {
  CreateExportRequest,
  ExportContentType,
  ExportJobDetail,
  ExportStatus,
} from '../types';

// ─── Query Keys ──────────────────────────────────────────────────────────

const exportKeys = {
  all: ['exports'] as const,
  detail: (id: string) => ['exports', id] as const,
};

// ─── Create Export ───────────────────────────────────────────────────────

export function useCreateExport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateExportRequest) => {
      // NO `.data`: `POST /exports` returns a bare { success, data } envelope,
      // which `apiClient` already strips.
      return apiClient.post<ExportJobDetail>('/exports', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: exportKeys.all });
    },
  });
}

// ─── Get Export Job (with polling while processing) ─────────────────────

export function useExportJob(id: string | null) {
  return useQuery({
    queryKey: exportKeys.detail(id ?? ''),
    queryFn: async () => {
      // Bare { success, data } envelope — already unwrapped by `apiClient`.
      return apiClient.get<ExportJobDetail>(`/exports/${id}`);
    },
    enabled: !!id,
    refetchInterval: (query) => {
      const job = query.state.data as ExportJobDetail | undefined;
      if (
        job &&
        (job.status === 'pending' || job.status === 'processing')
      ) {
        return 2000;
      }
      return false;
    },
  });
}

// ─── Download & Share ───────────────────────────────────────────────────

export function useDownloadExport() {
  return useMutation({
    mutationFn: async (job: ExportJobDetail) => {
      const { url, headers } = await apiClient.getDownloadUrl(
        `/exports/${job.id}/download`,
      );

      const ext = job.format === 'docx' ? 'docx' : 'pdf';
      const safeName = (job.filename ?? `export-${job.id}`)
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9 _-]/g, '')
        .slice(0, 60);
      const localUri = `${FileSystem.cacheDirectory}${safeName}.${ext}`;

      const result = await FileSystem.downloadAsync(url, localUri, {
        headers,
      });

      if (result.status !== 200) {
        throw new Error(`Download failed with status ${result.status}`);
      }

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        const mimeType =
          ext === 'docx'
            ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : 'application/pdf';
        await Sharing.shareAsync(result.uri, { mimeType });
      } else {
        Alert.alert('Downloaded', `File saved to ${result.uri}`);
      }
    },
    onError: (error: Error) => {
      Alert.alert('Download Failed', error.message);
    },
  });
}

// ─── Combined: Create → Poll → Download ─────────────────────────────────

interface ExportState {
  jobId: string | null;
  status: ExportStatus | 'idle';
  job: ExportJobDetail | null;
  create: (contentType: ExportContentType, contentId: string, format: 'pdf' | 'docx') => void;
  download: () => void;
  reset: () => void;
  isCreating: boolean;
  isDownloading: boolean;
}

export function useExportFlow(): ExportState {
  const createExport = useCreateExport();
  const downloadExport = useDownloadExport();
  const jobId = createExport.data?.id ?? null;
  const { data: job } = useExportJob(jobId);

  const status: ExportStatus | 'idle' = job?.status ?? (createExport.isPending ? 'processing' : 'idle');

  return {
    jobId,
    status,
    job: job ?? null,
    create: (contentType, contentId, format) => {
      createExport.mutate({ contentType, contentId, format });
    },
    download: () => {
      if (job && job.status === 'completed') {
        downloadExport.mutate(job);
      }
    },
    reset: () => {
      createExport.reset();
    },
    isCreating: createExport.isPending,
    isDownloading: downloadExport.isPending,
  };
}

'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import {
  meetsMinimumTier,
  useSubscription,
} from '@/features/billing/hooks/use-subscription';
import { useAuthStore } from '@/stores/auth-store';

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20MB
export const MAX_PDF_BYTES = 50 * 1024 * 1024; // 50MB

export const ACCEPTED_UPLOAD_EXTENSIONS = '.pdf,.jpg,.jpeg,.png,.webp';

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Client-side pre-flight validation for document uploads.
 * Returns a human-readable error message, or null when the file is acceptable.
 * The API re-validates everything (magic bytes, size) server-side.
 */
export function validateDocumentFile(file: File): string | null {
  const isPdf =
    file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isImage =
    IMAGE_MIME_TYPES.includes(file.type) ||
    /\.(jpe?g|png|webp)$/i.test(file.name);

  if (!isPdf && !isImage) {
    return 'Unsupported file type. Upload a PDF, JPEG, PNG, or WebP file.';
  }
  if (isPdf && file.size > MAX_PDF_BYTES) {
    return 'PDF files must be 50MB or smaller.';
  }
  if (!isPdf && file.size > MAX_IMAGE_BYTES) {
    return 'Image files must be 20MB or smaller.';
  }
  return null;
}

export interface CanUploadDocumentsResult {
  /** True when the user may upload documents (Pro+ plan or platform admin). */
  allowed: boolean;
  /** True while the subscription query is still resolving for a non-admin. */
  loading: boolean;
}

/**
 * Document uploads are a Pro+ feature (free/edu plans have a
 * documentUploadsPerMonth quota of 0). Platform admins bypass the gate,
 * mirroring useCanAccessPaidFeature.
 */
export function useCanUploadDocuments(): CanUploadDocumentsResult {
  const user = useAuthStore((s) => s.user);
  const { data: sub, isLoading } = useSubscription();

  if (user?.isPlatformAdmin) {
    return { allowed: true, loading: false };
  }
  if (isLoading) {
    return { allowed: false, loading: true };
  }
  const activePaid =
    !!sub && (sub.status === 'active' || sub.status === 'trialing');
  return {
    allowed: activePaid && meetsMinimumTier(sub?.planCode, 'pro'),
    loading: false,
  };
}

export interface UploadDocumentResponse {
  success: boolean;
  data: {
    id: string;
    jobId: string;
    status: string;
  };
}

export interface UploadDocumentInput {
  file: File;
  onProgress?: (percent: number) => void;
}

/**
 * Upload a document file (PDF or image) via POST /uploads.
 *
 * The API returns 202 Accepted with the created upload ID and a processing
 * job ID; OCR runs asynchronously. On success the scans list is invalidated
 * so the new row appears immediately.
 */
export function useUploadDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: UploadDocumentInput) => {
      const formData = new FormData();
      formData.append('file', params.file);

      return apiClient.uploadMultipart<UploadDocumentResponse>('/uploads', formData, {
        onProgress: params.onProgress,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scans'] });
    },
  });
}

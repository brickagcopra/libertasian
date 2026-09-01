import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Platform } from 'react-native';
import { apiClient } from '../../../lib/api-client';
import { IMAGE_UPLOAD } from '../../../lib/constants';
import type {
  CapturedPage,
  CaptureMode,
  PrivacyLevel,
  UploadResponse,
} from '../types';

interface UploadScanParams {
  pages: CapturedPage[];
  captureMode: CaptureMode;
  privacyLevel: PrivacyLevel;
  onProgress?: (progress: number) => void;
}

// Resolves with the UNWRAPPED payload: `POST /uploads/camera-scan` returns a
// bare { success, data } envelope and `uploadMultipart` already strips it.
async function uploadCameraScan(
  params: UploadScanParams,
): Promise<UploadResponse['data']> {
  const { pages, captureMode, privacyLevel, onProgress } = params;

  const formData = new FormData();
  formData.append('captureMode', captureMode);
  formData.append('privacyLevel', privacyLevel);
  formData.append('devicePlatform', Platform.OS === 'ios' ? 'ios' : 'android');

  for (const page of pages) {
    const uri = page.uri;
    const filename = `scan_${page.id}.jpg`;
    formData.append('files', {
      uri,
      name: filename,
      type: 'image/jpeg',
    } as unknown as Blob);
  }

  return apiClient.uploadMultipart<UploadResponse['data']>(
    '/uploads/camera-scan',
    formData,
    { onProgress },
  );
}

export function useUploadScan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: uploadCameraScan,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['uploads'] });
    },
  });
}

export { IMAGE_UPLOAD };

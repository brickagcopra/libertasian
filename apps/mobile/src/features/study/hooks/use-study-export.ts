import { useMutation } from '@tanstack/react-query';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';

import { apiClient } from '../../../lib/api-client';
import type { ExportFormat } from '../types';

async function downloadAndShare(
  endpoint: string,
  format: ExportFormat,
  fallbackFilename: string,
) {
  const { url, headers } = await apiClient.getDownloadUrl(endpoint, { format });

  const ext = format === 'docx' ? 'docx' : 'pdf';
  const safeName = fallbackFilename.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 60);
  const localUri = `${FileSystem.cacheDirectory}${safeName}.${ext}`;

  const result = await FileSystem.downloadAsync(url, localUri, { headers });

  if (result.status !== 200) {
    throw new Error(`Download failed with status ${result.status}`);
  }

  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    const mimeType =
      format === 'docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/pdf';
    await Sharing.shareAsync(result.uri, { mimeType });
  } else {
    Alert.alert('Downloaded', `File saved to ${result.uri}`);
  }
}

export function useExportFlashcardSet() {
  return useMutation({
    mutationFn: async ({
      id,
      format,
      title,
    }: {
      id: string;
      format: ExportFormat;
      title: string;
    }) => {
      await downloadAndShare(
        `/study/flashcard-sets/${id}/export`,
        format,
        `${title}-flashcards`,
      );
    },
    onError: (error: Error) => {
      Alert.alert('Export Failed', error.message);
    },
  });
}

export function useExportReviewerPack() {
  return useMutation({
    mutationFn: async ({
      id,
      format,
      title,
    }: {
      id: string;
      format: ExportFormat;
      title: string;
    }) => {
      await downloadAndShare(
        `/study/reviewer-packs/${id}/export`,
        format,
        `${title}-reviewer-pack`,
      );
    },
    onError: (error: Error) => {
      Alert.alert('Export Failed', error.message);
    },
  });
}

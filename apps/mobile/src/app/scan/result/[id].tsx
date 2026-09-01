import { useCallback, useState } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  Text,
  ActivityIndicator,
  Alert,
  TextInput,
} from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScanResult } from '../../../features/camera-scan/components/scan-result';
import { useUploadDetail } from '../../../features/camera-scan/hooks/use-upload-status';
import { useOcrResults } from '../../../features/camera-scan/hooks/use-ocr-results';
import { useGenerateDigest } from '../../../features/camera-scan/hooks/use-generate-digest';
import { useGenerateFlashcardsFromScan } from '../../../features/camera-scan/hooks/use-generate-flashcards';
import { useGenerateOutlineFromScan } from '../../../features/camera-scan/hooks/use-generate-outline';
import { useAttachToMatter } from '../../../features/camera-scan/hooks/use-attach-to-matter';

export default function ScanResultScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const uploadId = id ?? null;

  const { data: upload, isLoading: isLoadingUpload } = useUploadDetail(uploadId);
  const { data: ocrData, isLoading: isLoadingOcr } = useOcrResults(
    uploadId,
    !!upload && upload.ocrStatus !== 'pending',
  );

  const digestMutation = useGenerateDigest();
  const flashcardMutation = useGenerateFlashcardsFromScan();
  const outlineMutation = useGenerateOutlineFromScan();
  const attachMutation = useAttachToMatter();

  // Availability is a function of the scan itself, not of who is asking. The
  // server is the only authority on entitlement; gating here on a planCode
  // would keep this locked no matter what the API allows.
  const canGenerateDigest =
    !!upload &&
    upload.ocrStatus === 'completed' &&
    upload.processingStatus === 'completed';

  const handleGenerateDigest = useCallback(() => {
    if (!uploadId) return;
    digestMutation.mutate({ uploadId });
  }, [uploadId, digestMutation]);

  const handleGenerateFlashcards = useCallback(() => {
    if (!uploadId) return;
    Alert.prompt(
      'Generate Flashcards',
      'Enter the Flashcard Set ID to add generated cards to:',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Generate',
          onPress: (setId) => {
            if (setId?.trim()) {
              flashcardMutation.mutate({
                uploadId,
                flashcardSetId: setId.trim(),
              });
            }
          },
        },
      ],
      'plain-text',
    );
  }, [uploadId, flashcardMutation]);

  const handleGenerateOutline = useCallback(() => {
    if (!uploadId) return;
    outlineMutation.mutate({ uploadId });
  }, [uploadId, outlineMutation]);

  const handleAttachToMatter = useCallback(() => {
    if (!uploadId) return;
    Alert.prompt(
      'Link to Matter',
      'Enter the Matter ID to attach this scan to:',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Attach',
          onPress: (matterId) => {
            if (matterId?.trim()) {
              attachMutation.mutate({
                uploadId,
                matterId: matterId.trim(),
              });
            }
          },
        },
      ],
      'plain-text',
    );
  }, [uploadId, attachMutation]);

  const handleViewDigest = useCallback(() => {
    // NO second `.data`: every `/uploads/:id/generate-*` route returns a bare
    // { success, data } envelope, already stripped by `apiClient`. The extra
    // hop made `digestId` undefined, so "View digest" silently did nothing.
    if (digestMutation.data?.digestId) {
      router.push({
        pathname: '/digest/[id]',
        params: { id: digestMutation.data.digestId },
      });
    }
  }, [digestMutation.data]);

  if (isLoadingUpload) {
    return (
      <View style={styles.container}>
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#1a56db" />
          <Text style={styles.loadingText}>Loading scan details...</Text>
        </View>
      </View>
    );
  }

  if (!upload) {
    return (
      <View style={styles.container}>
        <View style={styles.errorState}>
          <Ionicons name="alert-circle-outline" size={48} color="#9ca3af" />
          <Text style={styles.errorText}>Scan not found</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerRight: () =>
            digestMutation.isSuccess ? (
              <TouchableOpacity onPress={handleViewDigest}>
                <Ionicons name="document-text" size={24} color="#1C1A14" />
              </TouchableOpacity>
            ) : null,
        }}
      />

      <ScanResult
        upload={upload}
        ocrData={ocrData ?? null}
        isLoadingOcr={isLoadingOcr}
        onGenerateDigest={handleGenerateDigest}
        isGeneratingDigest={digestMutation.isPending}
        canGenerateDigest={canGenerateDigest}
        digestError={digestMutation.error?.message ?? null}
        onGenerateFlashcards={handleGenerateFlashcards}
        isGeneratingFlashcards={flashcardMutation.isPending}
        flashcardResult={flashcardMutation.data ?? null}
        onGenerateOutline={handleGenerateOutline}
        isGeneratingOutline={outlineMutation.isPending}
        outlineResult={outlineMutation.data ?? null}
        onAttachToMatter={handleAttachToMatter}
        isAttaching={attachMutation.isPending}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 12,
  },
  errorState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  errorText: {
    fontSize: 16,
    color: '#6b7280',
    marginTop: 12,
    marginBottom: 24,
  },
  backButton: {
    backgroundColor: '#1a56db',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  backButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});

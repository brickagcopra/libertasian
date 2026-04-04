import { useCallback, useState } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Text,
  ActivityIndicator,
  Alert,
  TextInput,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScanResult } from '../../../features/camera-scan/components/scan-result';
import { useUploadDetail } from '../../../features/camera-scan/hooks/use-upload-status';
import { useOcrResults } from '../../../features/camera-scan/hooks/use-ocr-results';
import { useGenerateDigest } from '../../../features/camera-scan/hooks/use-generate-digest';
import { useGenerateFlashcardsFromScan } from '../../../features/camera-scan/hooks/use-generate-flashcards';
import { useGenerateOutlineFromScan } from '../../../features/camera-scan/hooks/use-generate-outline';
import { useAttachToMatter } from '../../../features/camera-scan/hooks/use-attach-to-matter';
import { useSubscription } from '../../../features/subscription/hooks/use-subscription';

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
  const { data: subscription } = useSubscription();

  // Entitlement check: free users get OCR only, edu+ can generate digests
  const isPaidPlan =
    subscription?.planCode === 'edu' ||
    subscription?.planCode === 'pro' ||
    subscription?.planCode === 'team' ||
    subscription?.planCode === 'enterprise';
  const canGenerateDigest =
    isPaidPlan &&
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
    if (digestMutation.data?.data?.digestId) {
      router.push({
        pathname: '/digest/[id]',
        params: { id: digestMutation.data.data.digestId },
      });
    }
  }, [digestMutation.data]);

  if (isLoadingUpload) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#374151" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Scan Result</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#1a56db" />
          <Text style={styles.loadingText}>Loading scan details...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!upload) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#374151" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Scan Result</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.errorState}>
          <Ionicons name="alert-circle-outline" size={48} color="#9ca3af" />
          <Text style={styles.errorText}>Scan not found</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="arrow-back" size={24} color="#374151" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Scan Result</Text>
        {digestMutation.isSuccess && (
          <TouchableOpacity onPress={handleViewDigest}>
            <Ionicons name="document-text" size={24} color="#1a56db" />
          </TouchableOpacity>
        )}
        {!digestMutation.isSuccess && <View style={{ width: 24 }} />}
      </View>

      <ScanResult
        upload={upload}
        ocrData={ocrData ?? null}
        isLoadingOcr={isLoadingOcr}
        onGenerateDigest={handleGenerateDigest}
        isGeneratingDigest={digestMutation.isPending}
        canGenerateDigest={canGenerateDigest}
        digestError={digestMutation.error?.message ?? null}
        showUpgradePrompt={
          !isPaidPlan &&
          !!upload &&
          upload.ocrStatus === 'completed' &&
          upload.processingStatus === 'completed'
        }
        onGenerateFlashcards={handleGenerateFlashcards}
        isGeneratingFlashcards={flashcardMutation.isPending}
        flashcardResult={flashcardMutation.data?.data ?? null}
        onGenerateOutline={handleGenerateOutline}
        isGeneratingOutline={outlineMutation.isPending}
        outlineResult={outlineMutation.data?.data ?? null}
        onAttachToMatter={handleAttachToMatter}
        isAttaching={attachMutation.isPending}
        isPaidPlan={isPaidPlan}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#111827',
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

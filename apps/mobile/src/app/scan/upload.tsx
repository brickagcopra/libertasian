import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { UploadProgress } from '../../features/camera-scan/components/upload-progress';
import { useUploadScan } from '../../features/camera-scan/hooks/use-upload-scan';
import { useUploadStatus } from '../../features/camera-scan/hooks/use-upload-status';
import type { CapturedPage, PipelineStep, PrivacyLevel } from '../../features/camera-scan/types';

export default function UploadScreen() {
  const params = useLocalSearchParams<{
    pageUris: string;
    pageWidths: string;
    pageHeights: string;
    pageIds: string;
    pageCount: string;
  }>();

  const pages = useMemo<CapturedPage[]>(() => {
    if (!params.pageUris) return [];
    const uris = params.pageUris.split('|');
    const widths = (params.pageWidths ?? '').split('|');
    const heights = (params.pageHeights ?? '').split('|');
    const ids = (params.pageIds ?? '').split('|');
    return uris.map((uri, i) => ({
      uri,
      width: parseInt(widths[i] ?? '0', 10),
      height: parseInt(heights[i] ?? '0', 10),
      id: ids[i] ?? `page_${i}`,
    }));
  }, [params.pageUris, params.pageWidths, params.pageHeights, params.pageIds]);

  const [privacyLevel, setPrivacyLevel] = useState<PrivacyLevel>('private');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<PipelineStep>('uploading');

  const uploadMutation = useUploadScan();
  const { data: statusData } = useUploadStatus(
    uploadId,
    uploadId !== null && currentStep !== 'complete' && currentStep !== 'failed',
  );

  // Map processing status to pipeline step
  useEffect(() => {
    if (!statusData) return;

    const { processingStatus, ocrStatus } = statusData;

    if (processingStatus === 'failed') {
      setCurrentStep('failed');
      return;
    }

    if (processingStatus === 'completed') {
      setCurrentStep('complete');
      return;
    }

    if (ocrStatus === 'completed') {
      setCurrentStep('citation_extraction');
    } else if (ocrStatus === 'processing') {
      setCurrentStep('ocr');
    } else if (processingStatus === 'processing') {
      setCurrentStep('quality_check');
    }
  }, [statusData]);

  const handleUpload = useCallback(() => {
    if (pages.length === 0) return;

    setCurrentStep('uploading');
    setUploadProgress(0);

    uploadMutation.mutate(
      {
        pages,
        captureMode: pages.length > 1 ? 'multi_page' : 'single_page',
        privacyLevel,
        onProgress: (progress) => {
          setUploadProgress(progress);
        },
      },
      {
        onSuccess: (response) => {
          setUploadId(response.data.id);
          setCurrentStep('quality_check');
        },
        onError: (error) => {
          setCurrentStep('failed');
          Alert.alert('Upload Failed', error.message);
        },
      },
    );
  }, [pages, privacyLevel, uploadMutation]);

  const handleTogglePrivacy = useCallback(() => {
    if (privacyLevel === 'private') {
      Alert.alert(
        'Editorial Candidate',
        'By marking this scan as an editorial candidate, editors may review the content for potential inclusion in the public legal corpus.\n\nThe content will remain private unless explicitly approved by an editor after a rights review.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Confirm',
            onPress: () => setPrivacyLevel('editorial_candidate'),
          },
        ],
      );
    } else {
      setPrivacyLevel('private');
    }
  }, [privacyLevel]);

  const handleViewResult = useCallback(() => {
    if (uploadId) {
      router.replace({
        pathname: '/scan/result/[id]',
        params: { id: uploadId },
      });
    }
  }, [uploadId]);

  const isUploading = uploadMutation.isPending;
  const isProcessing = uploadId !== null && currentStep !== 'complete' && currentStep !== 'failed';
  const isDone = currentStep === 'complete';
  const isFailed = currentStep === 'failed';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          disabled={isUploading || isProcessing}
        >
          <Ionicons name="arrow-back" size={24} color={isUploading || isProcessing ? '#d1d5db' : '#374151'} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Upload Scan</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Summary */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Ionicons name="images-outline" size={20} color="#6b7280" />
            <Text style={styles.summaryText}>
              {pages.length} page{pages.length !== 1 ? 's' : ''} ready to upload
            </Text>
          </View>

          {/* Privacy toggle */}
          <TouchableOpacity
            style={styles.privacyRow}
            onPress={handleTogglePrivacy}
            disabled={isUploading || isProcessing}
          >
            <Ionicons
              name={privacyLevel === 'private' ? 'lock-closed' : 'eye'}
              size={18}
              color={privacyLevel === 'private' ? '#059669' : '#d97706'}
            />
            <Text style={styles.privacyText}>
              {privacyLevel === 'private' ? 'Private' : 'Editorial Candidate'}
            </Text>
            <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
          </TouchableOpacity>
        </View>

        {/* Upload/processing progress */}
        {(isUploading || isProcessing || isDone || isFailed) && (
          <UploadProgress
            uploadProgress={uploadProgress}
            currentStep={currentStep}
            error={
              isFailed
                ? uploadMutation.error?.message ?? 'Processing failed'
                : null
            }
          />
        )}

        {/* Action buttons */}
        {!isUploading && !isProcessing && !isDone && (
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.uploadButton}
              onPress={handleUpload}
              activeOpacity={0.7}
            >
              <Ionicons name="cloud-upload-outline" size={20} color="#fff" />
              <Text style={styles.uploadButtonText}>Upload & Process</Text>
            </TouchableOpacity>
          </View>
        )}

        {isDone && (
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.viewResultButton}
              onPress={handleViewResult}
              activeOpacity={0.7}
            >
              <Ionicons name="document-text-outline" size={20} color="#fff" />
              <Text style={styles.uploadButtonText}>View Results</Text>
            </TouchableOpacity>
          </View>
        )}

        {isFailed && !isUploading && (
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={handleUpload}
              activeOpacity={0.7}
            >
              <Ionicons name="refresh-outline" size={20} color="#fff" />
              <Text style={styles.uploadButtonText}>Retry Upload</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  summaryCard: {
    backgroundColor: '#fff',
    margin: 16,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  summaryText: {
    fontSize: 15,
    color: '#374151',
    fontWeight: '500',
  },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  privacyText: {
    flex: 1,
    fontSize: 14,
    color: '#374151',
  },
  actions: {
    padding: 16,
    gap: 12,
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1a56db',
    paddingVertical: 14,
    borderRadius: 10,
  },
  viewResultButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#059669',
    paddingVertical: 14,
    borderRadius: 10,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#ef4444',
    paddingVertical: 14,
    borderRadius: 10,
  },
  uploadButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});

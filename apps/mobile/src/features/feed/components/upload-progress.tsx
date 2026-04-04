import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { FeedMediaProcessingStatus } from '@libertasian/types';

interface UploadProgressProps {
  uploadProgress: number;
  processingStatus: FeedMediaProcessingStatus | null;
}

const STATUS_LABELS: Record<FeedMediaProcessingStatus, string> = {
  pending: 'Waiting...',
  uploading: 'Uploading...',
  processing: 'Processing...',
  ready: 'Ready',
  failed: 'Failed',
  quarantined: 'Rejected',
};

const STATUS_COLORS: Record<FeedMediaProcessingStatus, string> = {
  pending: '#9ca3af',
  uploading: '#1a56db',
  processing: '#d97706',
  ready: '#059669',
  failed: '#dc2626',
  quarantined: '#dc2626',
};

export function UploadProgress({ uploadProgress, processingStatus }: UploadProgressProps) {
  const isUploading = !processingStatus || processingStatus === 'uploading';
  const progress = isUploading ? uploadProgress : processingStatus === 'ready' ? 1 : 0.5;
  const color = processingStatus ? STATUS_COLORS[processingStatus] : '#1a56db';
  const label = processingStatus ? STATUS_LABELS[processingStatus] : `${Math.round(uploadProgress * 100)}%`;

  return (
    <View style={styles.container}>
      <View style={styles.barBg}>
        <View style={[styles.barFill, { width: `${progress * 100}%`, backgroundColor: color }]} />
      </View>
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  barBg: {
    flex: 1,
    height: 4,
    backgroundColor: '#e5e7eb',
    borderRadius: 2,
    overflow: 'hidden',
  },
  barFill: {
    height: 4,
    borderRadius: 2,
  },
  label: {
    fontSize: 11,
    fontWeight: '500',
    minWidth: 72,
    textAlign: 'right',
  },
});

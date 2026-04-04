import React from 'react';
import { View, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { FeedMediaProcessingStatus } from '@libertasian/types';
import { UploadProgress } from './upload-progress';

interface ImagePreviewProps {
  uri: string;
  width?: number;
  height?: number;
  uploadProgress?: number;
  processingStatus?: FeedMediaProcessingStatus | null;
  onRemove?: () => void;
  editable?: boolean;
}

export function ImagePreview({
  uri,
  width,
  height,
  uploadProgress,
  processingStatus,
  onRemove,
  editable = false,
}: ImagePreviewProps) {
  const aspectRatio = width && height ? width / height : 16 / 9;
  const showProgress = uploadProgress !== undefined && processingStatus !== 'ready';

  return (
    <View style={styles.container}>
      <Image
        source={{ uri }}
        style={[styles.image, { aspectRatio }]}
        resizeMode="cover"
      />
      {editable && onRemove && (
        <TouchableOpacity
          style={styles.removeButton}
          onPress={onRemove}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="close-circle" size={24} color="#fff" />
        </TouchableOpacity>
      )}
      {showProgress && (
        <View style={styles.progressOverlay}>
          <UploadProgress
            uploadProgress={uploadProgress ?? 0}
            processingStatus={processingStatus ?? null}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#f3f4f6',
    marginTop: 10,
  },
  image: {
    width: '100%',
    borderRadius: 10,
  },
  removeButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 12,
  },
  progressOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(255,255,255,0.9)',
    padding: 8,
  },
});

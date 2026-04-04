import { useState, useCallback } from 'react';
import {
  View,
  Image,
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Dimensions,
} from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import { Ionicons } from '@expo/vector-icons';
import { IMAGE_UPLOAD } from '../../../lib/constants';
import type { CapturedPage } from '../types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface ImagePreviewProps {
  page: CapturedPage;
  onUpdate: (updated: CapturedPage) => void;
}

type EnhanceAction = 'rotate' | 'contrast' | 'compress';

export function ImagePreview({ page, onUpdate }: ImagePreviewProps) {
  const [processing, setProcessing] = useState(false);
  const [rotation, setRotation] = useState(0);

  const applyManipulation = useCallback(
    async (action: EnhanceAction) => {
      if (processing) return;
      setProcessing(true);

      try {
        let actions: ImageManipulator.Action[] = [];

        switch (action) {
          case 'rotate': {
            const newRotation = (rotation + 90) % 360;
            setRotation(newRotation);
            actions = [{ rotate: 90 }];
            break;
          }
          case 'compress': {
            actions = [
              {
                resize: {
                  width: Math.min(page.width, IMAGE_UPLOAD.MAX_WIDTH),
                },
              },
            ];
            break;
          }
          case 'contrast':
            // expo-image-manipulator doesn't have native contrast
            // We resize slightly to trigger re-encoding with quality optimization
            actions = [
              {
                resize: {
                  width: page.width,
                  height: page.height,
                },
              },
            ];
            break;
        }

        const result = await ImageManipulator.manipulateAsync(page.uri, actions, {
          compress: IMAGE_UPLOAD.JPEG_QUALITY,
          format: ImageManipulator.SaveFormat.JPEG,
        });

        onUpdate({
          ...page,
          uri: result.uri,
          width: result.width,
          height: result.height,
        });
      } finally {
        setProcessing(false);
      }
    },
    [page, processing, rotation, onUpdate],
  );

  const optimizeForUpload = useCallback(async () => {
    if (processing) return;
    setProcessing(true);

    try {
      const needsResize = page.width > IMAGE_UPLOAD.MAX_WIDTH;
      const actions: ImageManipulator.Action[] = needsResize
        ? [{ resize: { width: IMAGE_UPLOAD.MAX_WIDTH } }]
        : [];

      const result = await ImageManipulator.manipulateAsync(page.uri, actions, {
        compress: IMAGE_UPLOAD.JPEG_QUALITY,
        format: ImageManipulator.SaveFormat.JPEG,
      });

      onUpdate({
        ...page,
        uri: result.uri,
        width: result.width,
        height: result.height,
      });
    } finally {
      setProcessing(false);
    }
  }, [page, processing, onUpdate]);

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.imageScroll}
        contentContainerStyle={styles.imageContainer}
        maximumZoomScale={3}
        minimumZoomScale={1}
        showsVerticalScrollIndicator={false}
      >
        <Image
          source={{ uri: page.uri }}
          style={[styles.image, { aspectRatio: page.width / page.height }]}
          resizeMode="contain"
        />
      </ScrollView>

      {processing && (
        <View style={styles.processingOverlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.processingText}>Processing...</Text>
        </View>
      )}

      <View style={styles.toolbar}>
        <TouchableOpacity
          style={styles.toolButton}
          onPress={() => applyManipulation('rotate')}
          disabled={processing}
        >
          <Ionicons name="refresh-outline" size={22} color={processing ? '#9ca3af' : '#374151'} />
          <Text style={[styles.toolLabel, processing && styles.toolLabelDisabled]}>Rotate</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.toolButton}
          onPress={optimizeForUpload}
          disabled={processing}
        >
          <Ionicons name="resize-outline" size={22} color={processing ? '#9ca3af' : '#374151'} />
          <Text style={[styles.toolLabel, processing && styles.toolLabelDisabled]}>Optimize</Text>
        </TouchableOpacity>

        <View style={styles.dimensions}>
          <Text style={styles.dimensionText}>
            {page.width} x {page.height}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111827',
  },
  imageScroll: {
    flex: 1,
  },
  imageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  image: {
    width: SCREEN_WIDTH - 32,
    maxHeight: '100%',
  },
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  processingText: {
    color: '#fff',
    fontSize: 14,
    marginTop: 8,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    gap: 24,
  },
  toolButton: {
    alignItems: 'center',
    gap: 2,
  },
  toolLabel: {
    fontSize: 11,
    color: '#374151',
    fontWeight: '500',
  },
  toolLabelDisabled: {
    color: '#9ca3af',
  },
  dimensions: {
    flex: 1,
    alignItems: 'flex-end',
  },
  dimensionText: {
    fontSize: 11,
    color: '#9ca3af',
  },
});

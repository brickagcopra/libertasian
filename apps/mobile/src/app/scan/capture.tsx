import { useState, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  Text,  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraCapture } from '../../features/camera-scan/components/camera-capture';
import { ImagePreview } from '../../features/camera-scan/components/image-preview';
import { PageQueue } from '../../features/camera-scan/components/page-queue';
import type { CapturedPage } from '../../features/camera-scan/types';

export default function CaptureScreen() {
  const [pages, setPages] = useState<CapturedPage[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<'camera' | 'preview'>('camera');

  const handleCapture = useCallback((page: CapturedPage) => {
    setPages((prev) => [...prev, page]);
    setSelectedIndex(pages.length);
    setMode('preview');
  }, [pages.length]);

  const handleClose = useCallback(() => {
    if (pages.length > 0) {
      Alert.alert(
        'Discard Scan?',
        `You have ${pages.length} captured page${pages.length !== 1 ? 's' : ''}. Discard them?`,
        [
          { text: 'Keep Scanning', style: 'cancel' },
          {
            text: 'Discard',
            style: 'destructive',
            onPress: () => router.back(),
          },
        ],
      );
    } else {
      router.back();
    }
  }, [pages.length]);

  const handleUpdatePage = useCallback(
    (updated: CapturedPage) => {
      setPages((prev) =>
        prev.map((p, i) => (i === selectedIndex ? updated : p)),
      );
    },
    [selectedIndex],
  );

  const handleDeletePage = useCallback(
    (index: number) => {
      setPages((prev) => prev.filter((_, i) => i !== index));
      if (selectedIndex >= pages.length - 1) {
        setSelectedIndex(Math.max(0, pages.length - 2));
      }
      if (pages.length <= 1) {
        setMode('camera');
      }
    },
    [selectedIndex, pages.length],
  );

  const handleReorder = useCallback(
    (fromIndex: number, toIndex: number) => {
      setPages((prev) => {
        const next = [...prev];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        return next;
      });
      setSelectedIndex(toIndex);
    },
    [],
  );

  const handleAddMore = useCallback(() => {
    setMode('camera');
  }, []);

  const handleDone = useCallback(() => {
    if (pages.length === 0) return;
    // Navigate to upload screen with pages data
    // We use a global state approach since expo-router params can't hold complex objects
    router.push({
      pathname: '/scan/upload',
      params: {
        pageUris: pages.map((p) => p.uri).join('|'),
        pageWidths: pages.map((p) => String(p.width)).join('|'),
        pageHeights: pages.map((p) => String(p.height)).join('|'),
        pageIds: pages.map((p) => p.id).join('|'),
        pageCount: String(pages.length),
      },
    });
  }, [pages]);

  // react-native-safe-area-context, NOT react-native: RN's SafeAreaView is
  // a no-op on Android, so under targetSdk 35 edge-to-edge this screen
  // (which hides the native header) drew under the system bars.
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {mode === 'camera' ? (
        <CameraCapture
          onCapture={handleCapture}
          onClose={handleClose}
          pageCount={pages.length}
        />
      ) : (
        <View style={styles.previewContainer}>
          {pages[selectedIndex] && (
            <ImagePreview
              page={pages[selectedIndex]}
              onUpdate={handleUpdatePage}
            />
          )}

          {pages.length > 0 && (
            <PageQueue
              pages={pages}
              selectedIndex={selectedIndex}
              onSelect={setSelectedIndex}
              onDelete={handleDeletePage}
              onReorder={handleReorder}
            />
          )}

          {/* Action buttons */}
          <View style={styles.actionBar}>
            <ActionButton
              label="Add Page"
              iconName="add-circle-outline"
              onPress={handleAddMore}
            />
            <ActionButton
              label={`Done (${pages.length})`}
              iconName="checkmark-circle"
              onPress={handleDone}
              primary
            />
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

function ActionButton({
  label,
  iconName,
  onPress,
  primary = false,
}: {
  label: string;
  iconName: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.actionButton,
        primary && styles.actionButtonPrimary,
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Ionicons
        name={iconName}
        size={20}
        color={primary ? '#fff' : '#374151'}
      />
      <Text
        style={[
          styles.actionButtonText,
          primary && styles.actionButtonTextPrimary,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  previewContainer: {
    flex: 1,
    backgroundColor: '#111827',
  },
  actionBar: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  actionButtonPrimary: {
    backgroundColor: '#1a56db',
    borderColor: '#1a56db',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  actionButtonTextPrimary: {
    color: '#fff',
  },
});

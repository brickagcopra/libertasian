import { useState, useRef, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import type { CapturedPage } from '../types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GUIDE_PADDING = 32;
const GUIDE_WIDTH = SCREEN_WIDTH - GUIDE_PADDING * 2;
const GUIDE_HEIGHT = GUIDE_WIDTH * 1.414; // A4 aspect ratio

interface CameraCaptureProps {
  onCapture: (page: CapturedPage) => void;
  onClose: () => void;
  pageCount: number;
}

export function CameraCapture({ onCapture, onClose, pageCount }: CameraCaptureProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [flash, setFlash] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        skipProcessing: false,
      });

      if (photo) {
        onCapture({
          uri: photo.uri,
          width: photo.width,
          height: photo.height,
          id: `page_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        });
      }
    } finally {
      setCapturing(false);
    }
  }, [capturing, onCapture]);

  const toggleFlash = useCallback(() => {
    setFlash((prev) => !prev);
  }, []);

  if (!permission) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1a56db" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <Ionicons name="camera-outline" size={64} color="#9ca3af" />
        <Text style={styles.permissionTitle}>Camera Access Required</Text>
        <Text style={styles.permissionText}>
          To scan legal documents, LIBERTASIAN needs access to your camera.
        </Text>
        <TouchableOpacity style={styles.grantButton} onPress={requestPermission}>
          <Text style={styles.grantButtonText}>Grant Access</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
        flash={flash ? 'on' : 'off'}
      >
        {/* Top bar */}
        <View style={styles.topBar}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.pageCounter}>
            {pageCount > 0 ? `${pageCount} page${pageCount !== 1 ? 's' : ''} captured` : 'Scan Document'}
          </Text>
          <TouchableOpacity onPress={toggleFlash} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons
              name={flash ? 'flash' : 'flash-off'}
              size={24}
              color="#fff"
            />
          </TouchableOpacity>
        </View>

        {/* Document guide overlay */}
        <View style={styles.guideContainer}>
          <View style={styles.guideBorder}>
            {/* Corner markers */}
            <View style={[styles.corner, styles.topLeft]} />
            <View style={[styles.corner, styles.topRight]} />
            <View style={[styles.corner, styles.bottomLeft]} />
            <View style={[styles.corner, styles.bottomRight]} />
          </View>
          <Text style={styles.guideText}>
            Align document within the frame
          </Text>
        </View>

        {/* Bottom controls */}
        <View style={styles.bottomBar}>
          <View style={styles.bottomSpacer} />

          <TouchableOpacity
            style={[styles.captureButton, capturing && styles.captureButtonDisabled]}
            onPress={handleCapture}
            disabled={capturing}
            activeOpacity={0.7}
          >
            {capturing ? (
              <ActivityIndicator size="small" color="#1a56db" />
            ) : (
              <View style={styles.captureButtonInner} />
            )}
          </TouchableOpacity>

          <View style={styles.bottomSpacer}>
            {pageCount > 0 && (
              <View style={styles.pageBadge}>
                <Text style={styles.pageBadgeText}>{pageCount}</Text>
              </View>
            )}
          </View>
        </View>
      </CameraView>
    </View>
  );
}

const CORNER_SIZE = 24;
const CORNER_THICKNESS = 3;

/**
 * Overlay spacing BELOW the safe area, not safe-area padding itself.
 * CameraCapture only ever renders inside scan/capture.tsx, whose
 * SafeAreaView (now the react-native-safe-area-context one, which unlike
 * RN's works on Android) already consumes the status- and nav-bar insets.
 * Adding insets here too would double-pad and shift iOS.
 */
const OVERLAY_TOP_SPACING = 56;
const OVERLAY_BOTTOM_SPACING = 40;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
    justifyContent: 'space-between',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
    padding: 32,
  },
  permissionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
    marginTop: 16,
    marginBottom: 8,
  },
  permissionText: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  grantButton: {
    backgroundColor: '#1a56db',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  grantButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButton: {
    paddingHorizontal: 32,
    paddingVertical: 12,
  },
  cancelButtonText: {
    color: '#6b7280',
    fontSize: 14,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: OVERLAY_TOP_SPACING,
    paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  pageCounter: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  guideContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  guideBorder: {
    width: GUIDE_WIDTH,
    height: GUIDE_HEIGHT,
    maxHeight: '70%',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    borderRadius: 4,
    position: 'relative',
  },
  guideText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    marginTop: 12,
    textAlign: 'center',
  },
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
  },
  topLeft: {
    top: -1,
    left: -1,
    borderTopWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
    borderColor: '#fff',
    borderTopLeftRadius: 4,
  },
  topRight: {
    top: -1,
    right: -1,
    borderTopWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
    borderColor: '#fff',
    borderTopRightRadius: 4,
  },
  bottomLeft: {
    bottom: -1,
    left: -1,
    borderBottomWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
    borderColor: '#fff',
    borderBottomLeftRadius: 4,
  },
  bottomRight: {
    bottom: -1,
    right: -1,
    borderBottomWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
    borderColor: '#fff',
    borderBottomRightRadius: 4,
  },
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingBottom: OVERLAY_BOTTOM_SPACING,
    paddingTop: 20,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  bottomSpacer: {
    width: 50,
    alignItems: 'center',
  },
  captureButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  captureButtonDisabled: {
    opacity: 0.6,
  },
  captureButtonInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#fff',
  },
  pageBadge: {
    backgroundColor: '#1a56db',
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pageBadgeText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
});

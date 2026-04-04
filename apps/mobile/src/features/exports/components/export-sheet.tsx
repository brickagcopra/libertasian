import { useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useExportFlow } from '../hooks/use-exports';
import type { ExportContentType, ExportFormat } from '../types';

interface ExportSheetProps {
  visible: boolean;
  onClose: () => void;
  contentType: ExportContentType;
  contentId: string;
  title: string;
}

const FORMAT_OPTIONS: { format: ExportFormat; label: string; icon: string }[] = [
  {
    format: 'pdf',
    label: 'PDF Document',
    icon: 'document-text-outline',
  },
  {
    format: 'docx',
    label: 'Word Document',
    icon: 'reader-outline',
  },
];

export function ExportSheet({
  visible,
  onClose,
  contentType,
  contentId,
  title,
}: ExportSheetProps) {
  const flow = useExportFlow();

  useEffect(() => {
    if (!visible) {
      flow.reset();
    }
  }, [visible]);

  const handleSelectFormat = (format: ExportFormat) => {
    flow.create(contentType, contentId, format);
  };

  const handleDownload = () => {
    flow.download();
  };

  const isProcessing =
    flow.status === 'pending' ||
    flow.status === 'processing' ||
    flow.isCreating;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity
          style={styles.sheet}
          activeOpacity={1}
          onPress={() => {}}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.handle} />
            <View style={styles.headerRow}>
              <Text style={styles.headerTitle}>Export</Text>
              <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color="#6b7280" />
              </TouchableOpacity>
            </View>
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {title}
            </Text>
          </View>

          {/* Content */}
          {flow.status === 'idle' && (
            <View style={styles.body}>
              <Text style={styles.bodyLabel}>Choose format</Text>
              {FORMAT_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.format}
                  style={styles.formatOption}
                  onPress={() => handleSelectFormat(opt.format)}
                >
                  <Ionicons
                    name={opt.icon as keyof typeof Ionicons.glyphMap}
                    size={22}
                    color="#1a56db"
                  />
                  <View style={styles.formatInfo}>
                    <Text style={styles.formatLabel}>{opt.label}</Text>
                    <Text style={styles.formatExt}>.{opt.format}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
                </TouchableOpacity>
              ))}
            </View>
          )}

          {isProcessing && (
            <View style={styles.statusBody}>
              <ActivityIndicator size="large" color="#1a56db" />
              <Text style={styles.statusTitle}>Generating your file...</Text>
              <Text style={styles.statusSubtext}>
                This usually takes a few seconds
              </Text>
            </View>
          )}

          {flow.status === 'completed' && flow.job && (
            <View style={styles.statusBody}>
              <View style={styles.successIcon}>
                <Ionicons name="checkmark-circle" size={48} color="#059669" />
              </View>
              <Text style={styles.statusTitle}>Export ready</Text>
              {flow.job.fileSizeBytes && (
                <Text style={styles.statusSubtext}>
                  {flow.job.format.toUpperCase()} &middot;{' '}
                  {formatFileSize(flow.job.fileSizeBytes)}
                </Text>
              )}
              <TouchableOpacity
                style={styles.downloadButton}
                onPress={handleDownload}
                disabled={flow.isDownloading}
              >
                {flow.isDownloading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="download-outline" size={18} color="#fff" />
                    <Text style={styles.downloadButtonText}>
                      Download &amp; Share
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}

          {flow.status === 'failed' && (
            <View style={styles.statusBody}>
              <Ionicons name="alert-circle" size={48} color="#dc2626" />
              <Text style={styles.statusTitle}>Export failed</Text>
              <Text style={styles.statusSubtext}>
                {flow.job?.failureReason ?? 'An unexpected error occurred'}
              </Text>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={() => flow.reset()}
              >
                <Ionicons name="refresh-outline" size={16} color="#1a56db" />
                <Text style={styles.retryButtonText}>Try Again</Text>
              </TouchableOpacity>
            </View>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 34,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#d1d5db',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 6,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 2,
  },

  body: {
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 10,
  },
  bodyLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#9ca3af',
    marginBottom: 4,
  },
  formatOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  formatInfo: {
    flex: 1,
  },
  formatLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  formatExt: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 1,
  },

  statusBody: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 32,
    gap: 8,
  },
  successIcon: {},
  statusTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginTop: 4,
  },
  statusSubtext: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'center',
  },

  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1a56db',
    borderRadius: 10,
    paddingHorizontal: 24,
    paddingVertical: 12,
    marginTop: 12,
  },
  downloadButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },

  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#1a56db',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginTop: 12,
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a56db',
  },
});

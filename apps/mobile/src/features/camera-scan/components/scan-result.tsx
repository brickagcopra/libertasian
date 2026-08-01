import { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SCAN_QUALITY } from '../../../lib/constants';
import type { OcrResultsResponse, UploadDetail, OutlineSection } from '../types';
import { PrivacyToggle } from './privacy-toggle';

interface ScanResultProps {
  upload: UploadDetail;
  ocrData: OcrResultsResponse['data'] | null;
  isLoadingOcr: boolean;
  onGenerateDigest: () => void;
  isGeneratingDigest: boolean;
  canGenerateDigest: boolean;
  digestError?: string | null;
  /**
   * Show the neutral "not included in your plan" notice instead of the
   * generate action. Named `showUpgradePrompt` for continuity with its
   * callers; it no longer prompts an upgrade — nothing in the app may.
   */
  showUpgradePrompt?: boolean;
  onGenerateFlashcards?: () => void;
  isGeneratingFlashcards?: boolean;
  flashcardResult?: { generatedCount: number } | null;
  onGenerateOutline?: () => void;
  isGeneratingOutline?: boolean;
  outlineResult?: { outline: { title: string; sections: OutlineSection[] } } | null;
  onAttachToMatter?: () => void;
  isAttaching?: boolean;
  isPaidPlan?: boolean;
}

type Tab = 'ocr' | 'details' | 'citations' | 'outline';

export function ScanResult({
  upload,
  ocrData,
  isLoadingOcr,
  onGenerateDigest,
  isGeneratingDigest,
  canGenerateDigest,
  digestError,
  showUpgradePrompt = false,
  onGenerateFlashcards,
  isGeneratingFlashcards = false,
  flashcardResult,
  onGenerateOutline,
  isGeneratingOutline = false,
  outlineResult,
  onAttachToMatter,
  isAttaching = false,
  isPaidPlan = false,
}: ScanResultProps) {
  const [activeTab, setActiveTab] = useState<Tab>('ocr');

  const qualityScore = upload.cameraCaptures[0]?.captureQualityScore ?? null;
  const hasQualityWarning =
    qualityScore !== null && qualityScore < SCAN_QUALITY.WARN_THRESHOLD;
  const hasQualityError =
    qualityScore !== null && qualityScore < SCAN_QUALITY.REJECT_THRESHOLD;

  const renderQualityBadge = useCallback(() => {
    if (qualityScore === null) return null;

    if (hasQualityError) {
      return (
        <View style={[styles.badge, styles.badgeError]}>
          <Ionicons name="warning" size={14} color="#ef4444" />
          <Text style={styles.badgeErrorText}>Low Quality ({(qualityScore * 100).toFixed(0)}%)</Text>
        </View>
      );
    }
    if (hasQualityWarning) {
      return (
        <View style={[styles.badge, styles.badgeWarning]}>
          <Ionicons name="alert-circle" size={14} color="#d97706" />
          <Text style={styles.badgeWarningText}>Fair Quality ({(qualityScore * 100).toFixed(0)}%)</Text>
        </View>
      );
    }
    return (
      <View style={[styles.badge, styles.badgeSuccess]}>
        <Ionicons name="checkmark-circle" size={14} color="#059669" />
        <Text style={styles.badgeSuccessText}>Good Quality ({(qualityScore * 100).toFixed(0)}%)</Text>
      </View>
    );
  }, [qualityScore, hasQualityWarning, hasQualityError]);

  return (
    <View style={styles.container}>
      {/* Header info */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Scan Results</Text>
          {renderQualityBadge()}
        </View>

        {upload.classifiedDocumentType && (
          <View style={styles.classificationRow}>
            <Ionicons name="document-outline" size={16} color="#6b7280" />
            <Text style={styles.classificationText}>
              Classified as: <Text style={styles.classificationValue}>{upload.classifiedDocumentType}</Text>
            </Text>
          </View>
        )}

        {hasQualityError && (
          <View style={styles.qualityAlert}>
            <Ionicons name="warning" size={16} color="#ef4444" />
            <Text style={styles.qualityAlertText}>
              Image quality is very low. Consider retaking the scan for better OCR accuracy.
            </Text>
          </View>
        )}
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {(outlineResult
          ? (['ocr', 'citations', 'outline', 'details'] as Tab[])
          : (['ocr', 'citations', 'details'] as Tab[])
        ).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab === 'ocr' ? 'OCR Text' : tab === 'citations' ? 'Citations' : tab === 'outline' ? 'Outline' : 'Details'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Tab content */}
      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
        {isLoadingOcr && (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color="#1a56db" />
            <Text style={styles.loadingText}>Loading OCR results...</Text>
          </View>
        )}

        {!isLoadingOcr && activeTab === 'ocr' && (
          <View>
            {ocrData?.ocrText ? (
              <View style={styles.ocrTextContainer}>
                <Text style={styles.ocrText} selectable>{ocrData.ocrText}</Text>
              </View>
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="text-outline" size={48} color="#d1d5db" />
                <Text style={styles.emptyText}>
                  {ocrData?.ocrStatus === 'processing'
                    ? 'OCR is still processing...'
                    : ocrData?.ocrStatus === 'failed'
                    ? 'OCR processing failed. Try retaking the scan.'
                    : 'No text extracted yet.'}
                </Text>
              </View>
            )}
          </View>
        )}

        {!isLoadingOcr && activeTab === 'citations' && (
          <View>
            {ocrData?.extractedCitations?.citations &&
            ocrData.extractedCitations.citations.length > 0 ? (
              ocrData.extractedCitations.citations.map((citation, index) => (
                <View key={index} style={styles.citationItem}>
                  <View style={styles.citationBadge}>
                    <Text style={styles.citationBadgeText}>{citation.documentType}</Text>
                  </View>
                  <Text style={styles.citationText}>{citation.normalized || citation.text}</Text>
                </View>
              ))
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="link-outline" size={48} color="#d1d5db" />
                <Text style={styles.emptyText}>No citations extracted.</Text>
              </View>
            )}
          </View>
        )}

        {!isLoadingOcr && activeTab === 'outline' && outlineResult && (
          <View style={styles.outlineContainer}>
            <Text style={styles.outlineTitle}>{outlineResult.outline.title}</Text>
            {outlineResult.outline.sections.map((section, i) => (
              <View key={i} style={styles.outlineSection}>
                <Text style={styles.outlineSectionHeading}>{i + 1}. {section.heading}</Text>
                {section.key_points.map((point, j) => (
                  <View key={j} style={styles.outlinePoint}>
                    <Text style={styles.outlineBullet}>{'\u2022'}</Text>
                    <Text style={styles.outlinePointText}>{point}</Text>
                  </View>
                ))}
                {section.subsections?.map((sub, k) => (
                  <View key={k} style={styles.outlineSubsection}>
                    <Text style={styles.outlineSubHeading}>{i + 1}.{k + 1}. {sub.heading}</Text>
                    {sub.key_points.map((point, l) => (
                      <View key={l} style={styles.outlinePoint}>
                        <Text style={styles.outlineBullet}>{'\u2022'}</Text>
                        <Text style={styles.outlinePointText}>{point}</Text>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            ))}
          </View>
        )}

        {!isLoadingOcr && activeTab === 'details' && (
          <View style={styles.detailsList}>
            <DetailRow label="Upload ID" value={upload.id.slice(0, 8) + '...'} />
            <DetailRow label="Status" value={upload.processingStatus} />
            <DetailRow label="OCR Status" value={upload.ocrStatus} />
            <PrivacyToggle uploadId={upload.id} privacyLevel={upload.privacyLevel} />
            <DetailRow label="Pages" value={String(upload.pageCount ?? 1)} />
            {upload.classifiedDocumentType && (
              <DetailRow label="Document Type" value={upload.classifiedDocumentType} />
            )}
            {ocrData?.pages?.map((page) => (
              <View key={page.id}>
                <DetailRow
                  label={`Page ${page.pageNumber} Confidence`}
                  value={page.ocrConfidence ? `${(page.ocrConfidence * 100).toFixed(0)}%` : 'N/A'}
                />
                <DetailRow
                  label={`Page ${page.pageNumber} Words`}
                  value={String(page.wordCount ?? 0)}
                />
                {page.languageDetected && (
                  <DetailRow
                    label={`Page ${page.pageNumber} Language`}
                    value={page.languageDetected === 'tl' ? 'Filipino' : 'English'}
                  />
                )}
              </View>
            ))}
            <DetailRow
              label="Captured"
              value={new Date(upload.createdAt).toLocaleString()}
            />
          </View>
        )}
      </ScrollView>

      {/* Action buttons */}
      <View style={styles.footer}>
        {canGenerateDigest ? (
          <>
            <TouchableOpacity
              style={[styles.digestButton, isGeneratingDigest && styles.digestButtonDisabled]}
              onPress={onGenerateDigest}
              disabled={isGeneratingDigest}
            >
              {isGeneratingDigest ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="sparkles" size={18} color="#fff" />
              )}
              <Text style={styles.digestButtonText}>
                {isGeneratingDigest ? 'Generating Digest...' : 'Generate AI Digest'}
              </Text>
            </TouchableOpacity>

            {/* Secondary action row */}
            <View style={styles.secondaryActions}>
              {onGenerateFlashcards && isPaidPlan && (
                <TouchableOpacity
                  style={[styles.secondaryButton, isGeneratingFlashcards && styles.digestButtonDisabled]}
                  onPress={onGenerateFlashcards}
                  disabled={isGeneratingFlashcards}
                >
                  {isGeneratingFlashcards ? (
                    <ActivityIndicator size="small" color="#1a56db" />
                  ) : (
                    <Ionicons name="card-outline" size={16} color="#1a56db" />
                  )}
                  <Text style={styles.secondaryButtonText}>
                    {isGeneratingFlashcards ? 'Creating...' : 'Flashcards'}
                  </Text>
                </TouchableOpacity>
              )}

              {onGenerateOutline && isPaidPlan && (
                <TouchableOpacity
                  style={[styles.secondaryButton, isGeneratingOutline && styles.digestButtonDisabled]}
                  onPress={onGenerateOutline}
                  disabled={isGeneratingOutline}
                >
                  {isGeneratingOutline ? (
                    <ActivityIndicator size="small" color="#1a56db" />
                  ) : (
                    <Ionicons name="list-outline" size={16} color="#1a56db" />
                  )}
                  <Text style={styles.secondaryButtonText}>
                    {isGeneratingOutline ? 'Creating...' : 'Outline'}
                  </Text>
                </TouchableOpacity>
              )}

              {onAttachToMatter && (
                <TouchableOpacity
                  style={[styles.secondaryButton, isAttaching && styles.digestButtonDisabled]}
                  onPress={onAttachToMatter}
                  disabled={isAttaching}
                >
                  {isAttaching ? (
                    <ActivityIndicator size="small" color="#1a56db" />
                  ) : (
                    <Ionicons name="link-outline" size={16} color="#1a56db" />
                  )}
                  <Text style={styles.secondaryButtonText}>
                    {isAttaching ? 'Linking...' : 'Link to Matter'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {flashcardResult && (
              <View style={styles.successBanner}>
                <Ionicons name="checkmark-circle" size={16} color="#059669" />
                <Text style={styles.successText}>
                  Generated {flashcardResult.generatedCount} flashcards
                </Text>
              </View>
            )}
          </>
        ) : showUpgradePrompt ? (
          // Names no plan and offers no purchase (Apple 3.1.1 / Play
          // Payments). It still says what the user DOES have — the OCR text —
          // which is information, not an upsell.
          <View style={styles.upgradePrompt}>
            <Ionicons name="lock-closed" size={16} color="#d97706" />
            <Text style={styles.upgradeText}>
              AI digests from scans are not included in your plan. The OCR text
              above is available.
            </Text>
          </View>
        ) : null}

        {digestError && (
          <Text style={styles.digestError}>{digestError}</Text>
        )}
      </View>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  header: {
    backgroundColor: '#fff',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  classificationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  classificationText: {
    fontSize: 13,
    color: '#6b7280',
  },
  classificationValue: {
    fontWeight: '600',
    color: '#374151',
    textTransform: 'capitalize',
  },
  qualityAlert: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 12,
    backgroundColor: '#fef2f2',
    padding: 10,
    borderRadius: 8,
  },
  qualityAlertText: {
    fontSize: 12,
    color: '#ef4444',
    flex: 1,
    lineHeight: 18,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  badgeSuccess: {
    backgroundColor: '#ecfdf5',
  },
  badgeSuccessText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#059669',
  },
  badgeWarning: {
    backgroundColor: '#fffbeb',
  },
  badgeWarningText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#d97706',
  },
  badgeError: {
    backgroundColor: '#fef2f2',
  },
  badgeErrorText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#ef4444',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#1a56db',
  },
  tabText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#6b7280',
  },
  tabTextActive: {
    color: '#1a56db',
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  contentInner: {
    padding: 16,
    paddingBottom: 32,
  },
  loading: {
    alignItems: 'center',
    paddingVertical: 48,
  },
  loadingText: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 12,
  },
  ocrTextContainer: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  ocrText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#374151',
    fontFamily: 'monospace',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
  },
  emptyText: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 12,
    textAlign: 'center',
  },
  citationItem: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  citationBadge: {
    backgroundColor: '#eff6ff',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  citationBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#1d4ed8',
    textTransform: 'uppercase',
  },
  citationText: {
    fontSize: 13,
    color: '#374151',
    flex: 1,
  },
  detailsList: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    overflow: 'hidden',
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  detailLabel: {
    fontSize: 13,
    color: '#6b7280',
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '500',
    color: '#111827',
    textTransform: 'capitalize',
  },
  footer: {
    backgroundColor: '#fff',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  digestButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1a56db',
    paddingVertical: 14,
    borderRadius: 10,
  },
  digestButtonDisabled: {
    opacity: 0.6,
  },
  digestButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  upgradePrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f9fafb',
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  upgradeText: {
    fontSize: 13,
    color: '#6b7280',
    flex: 1,
    lineHeight: 18,
  },
  digestError: {
    fontSize: 12,
    color: '#ef4444',
    marginTop: 8,
    textAlign: 'center',
  },
  secondaryActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  secondaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
  },
  secondaryButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#1a56db',
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    backgroundColor: '#ecfdf5',
    padding: 10,
    borderRadius: 8,
  },
  successText: {
    fontSize: 13,
    color: '#059669',
    fontWeight: '500',
  },
  outlineContainer: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  outlineTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
  },
  outlineSection: {
    marginBottom: 12,
  },
  outlineSectionHeading: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 6,
  },
  outlinePoint: {
    flexDirection: 'row',
    gap: 8,
    paddingLeft: 8,
    marginBottom: 4,
  },
  outlineBullet: {
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 20,
  },
  outlinePointText: {
    fontSize: 13,
    color: '#4b5563',
    flex: 1,
    lineHeight: 20,
  },
  outlineSubsection: {
    paddingLeft: 16,
    marginTop: 6,
  },
  outlineSubHeading: {
    fontSize: 13,
    fontWeight: '500',
    color: '#374151',
    marginBottom: 4,
  },
});

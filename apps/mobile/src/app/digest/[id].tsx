import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useDigest } from '../../features/digests/hooks/use-digests';
import { ExportButton } from '../../features/exports/components/export-button';
import { ContentDisclaimer } from '../../features/documents/components/content-disclaimer';

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  draft: { bg: '#f3f4f6', text: '#6b7280' },
  ai_generated: { bg: '#eff6ff', text: '#1d4ed8' },
  needs_human_review: { bg: '#fef3c7', text: '#92400e' },
  approved: { bg: '#ecfdf5', text: '#059669' },
  rejected: { bg: '#fef2f2', text: '#dc2626' },
};

const SUBJECT_BADGE_COLORS: Record<string, { bg: string; text: string }> = {
  political_law: { bg: '#dbeafe', text: '#1d4ed8' },
  labor_law: { bg: '#fef3c7', text: '#92400e' },
  civil_law: { bg: '#d1fae5', text: '#065f46' },
  taxation_law: { bg: '#fee2e2', text: '#991b1b' },
  commercial_law: { bg: '#ede9fe', text: '#5b21b6' },
  criminal_law: { bg: '#f1f5f9', text: '#334155' },
  remedial_law: { bg: '#ccfbf1', text: '#115e59' },
  legal_ethics: { bg: '#ffedd5', text: '#9a3412' },
  public_international_law: { bg: '#cffafe', text: '#155e75' },
};

function getConfidenceColor(score: number | null): string {
  if (score === null) return '#9ca3af';
  if (score >= 0.7) return '#059669';
  if (score >= 0.4) return '#d97706';
  return '#dc2626';
}

function DigestSection({ label, content }: { label: string; content: string | null }) {
  if (!content) return null;
  return (
    <View style={styles.digestSection}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <Text style={styles.sectionContent}>{content}</Text>
    </View>
  );
}

function CollapsibleSection({
  title,
  icon,
  iconColor,
  children,
  defaultOpen,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen ?? false);
  return (
    <View style={styles.collapsibleSection}>
      <TouchableOpacity
        style={styles.collapsibleHeader}
        onPress={() => setIsOpen(!isOpen)}
        activeOpacity={0.7}
      >
        <Ionicons name={icon} size={18} color={iconColor} />
        <Text style={styles.collapsibleTitle}>{title}</Text>
        <Ionicons
          name={isOpen ? 'chevron-up' : 'chevron-down'}
          size={18}
          color="#9ca3af"
        />
      </TouchableOpacity>
      {isOpen ? <View style={styles.collapsibleBody}>{children}</View> : null}
    </View>
  );
}

function IracSection({
  issue,
  rule,
  application,
  conclusion,
}: {
  issue: string | null;
  rule: string | null;
  application: string | null;
  conclusion: string | null;
}) {
  return (
    <CollapsibleSection title="IRAC Analysis" icon="analytics-outline" iconColor="#7c3aed">
      {issue ? (
        <View style={styles.iracItem}>
          <Text style={styles.iracLabel}>Issue</Text>
          <Text style={styles.iracText}>{issue}</Text>
        </View>
      ) : null}
      {rule ? (
        <View style={styles.iracItem}>
          <Text style={styles.iracLabel}>Rule</Text>
          <Text style={styles.iracText}>{rule}</Text>
        </View>
      ) : null}
      {application ? (
        <View style={styles.iracItem}>
          <Text style={styles.iracLabel}>Application</Text>
          <Text style={styles.iracText}>{application}</Text>
        </View>
      ) : null}
      {conclusion ? (
        <View style={styles.iracItem}>
          <Text style={styles.iracLabel}>Conclusion</Text>
          <Text style={styles.iracText}>{conclusion}</Text>
        </View>
      ) : null}
    </CollapsibleSection>
  );
}

const CHOICE_LETTERS = ['A', 'B', 'C', 'D'] as const;

function McqSection({
  stem,
  choices,
  correctChoice,
  explanation,
}: {
  stem: string;
  choices: (string | null)[];
  correctChoice: string | null;
  explanation: string | null;
}) {
  const [revealed, setRevealed] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const handleChoiceTap = (idx: number) => {
    if (revealed) return;
    setSelectedIdx(idx);
    setRevealed(true);
  };

  return (
    <CollapsibleSection title="Practice MCQ" icon="help-circle-outline" iconColor="#0891b2" defaultOpen>
      <Text style={styles.mcqStem}>{stem}</Text>
      {choices.map((choice, idx) => {
        if (!choice) return null;
        const letter = CHOICE_LETTERS[idx];
        const isCorrect = correctChoice === letter;
        const isSelected = selectedIdx === idx;
        const showResult = revealed;

        return (
          <TouchableOpacity
            key={letter}
            style={[
              styles.mcqChoice,
              showResult && isCorrect && styles.mcqChoiceCorrect,
              showResult && isSelected && !isCorrect && styles.mcqChoiceWrong,
            ]}
            onPress={() => handleChoiceTap(idx)}
            activeOpacity={0.7}
            disabled={revealed}
          >
            <View
              style={[
                styles.mcqLetterCircle,
                showResult && isCorrect && styles.mcqLetterCorrect,
                showResult && isSelected && !isCorrect && styles.mcqLetterWrong,
              ]}
            >
              <Text
                style={[
                  styles.mcqLetter,
                  showResult && isCorrect && styles.mcqLetterTextCorrect,
                  showResult && isSelected && !isCorrect && styles.mcqLetterTextWrong,
                ]}
              >
                {letter}
              </Text>
            </View>
            <Text style={styles.mcqChoiceText}>{choice}</Text>
          </TouchableOpacity>
        );
      })}
      {revealed && explanation ? (
        <View style={styles.mcqExplanation}>
          <Ionicons name="bulb-outline" size={16} color="#92400e" />
          <Text style={styles.mcqExplanationText}>{explanation}</Text>
        </View>
      ) : null}
      {revealed ? (
        <TouchableOpacity
          style={styles.mcqResetButton}
          onPress={() => {
            setRevealed(false);
            setSelectedIdx(null);
          }}
        >
          <Text style={styles.mcqResetText}>Try Again</Text>
        </TouchableOpacity>
      ) : null}
    </CollapsibleSection>
  );
}

function OutlineSection({ outline }: { outline: Record<string, unknown> }) {
  const renderOutlineNode = (node: unknown, depth: number = 0): React.ReactNode => {
    if (typeof node === 'string') {
      return (
        <Text
          style={[styles.outlineText, { paddingLeft: depth * 16 }]}
          key={`${depth}-${node.slice(0, 20)}`}
        >
          {depth > 0 ? '\u2022 ' : ''}
          {node}
        </Text>
      );
    }
    if (Array.isArray(node)) {
      return node.map((item, idx) => (
        <View key={`${depth}-${idx}`}>{renderOutlineNode(item, depth)}</View>
      ));
    }
    if (node && typeof node === 'object') {
      return Object.entries(node as Record<string, unknown>).map(([key, value]) => (
        <View key={`${depth}-${key}`} style={{ marginBottom: 4 }}>
          <Text style={[styles.outlineHeading, { paddingLeft: depth * 16 }]}>
            {key}
          </Text>
          {renderOutlineNode(value, depth + 1)}
        </View>
      ));
    }
    return null;
  };

  return (
    <CollapsibleSection title="Subject Outline" icon="list-outline" iconColor="#059669">
      {renderOutlineNode(outline)}
    </CollapsibleSection>
  );
}

export default function DigestDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const digestId = id ?? '';
  const { data: digest, isLoading, error } = useDigest(digestId);

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Loading...' }} />
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color="#1a56db" />
        </View>
      </>
    );
  }

  if (error || !digest) {
    return (
      <>
        <Stack.Screen options={{ title: 'Error' }} />
        <View style={styles.errorState}>
          <Ionicons name="alert-circle-outline" size={48} color="#ef4444" />
          <Text style={styles.errorTitle}>Digest not found</Text>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  const statusStyle =
    STATUS_COLORS[digest.reviewStatus] ?? STATUS_COLORS['draft'];
  const subjectBadge = digest.barSubjectCode
    ? SUBJECT_BADGE_COLORS[digest.barSubjectCode] ?? { bg: '#f3f4f6', text: '#374151' }
    : null;

  const hasIrac = digest.iracIssue != null;
  const hasMcq = digest.mcqStem != null;
  const hasEssay = digest.essayPrompt != null;
  const hasOutline = digest.subjectOutlineJson != null;

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Digest Detail',
          headerBackTitle: 'Back',
          headerRight: () => (
            <ExportButton
              contentType="digest"
              contentId={digestId}
              title={digest.title}
            />
          ),
        }}
      />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.badges}>
            <View style={styles.typeBadge}>
              <Text style={styles.typeBadgeText}>
                {digest.digestType.replace(/_/g, ' ')}
              </Text>
            </View>
            <View
              style={[styles.statusBadge, { backgroundColor: statusStyle.bg }]}
            >
              <Text
                style={[styles.statusBadgeText, { color: statusStyle.text }]}
              >
                {digest.reviewStatus.replace(/_/g, ' ')}
              </Text>
            </View>
            <View style={styles.visibilityBadge}>
              <Ionicons
                name={
                  digest.visibility === 'private'
                    ? 'lock-closed-outline'
                    : 'globe-outline'
                }
                size={12}
                color="#6b7280"
              />
              <Text style={styles.visibilityText}>{digest.visibility}</Text>
            </View>
            {subjectBadge && digest.barSubjectCode ? (
              <View
                style={[
                  styles.subjectBadge,
                  { backgroundColor: subjectBadge.bg },
                ]}
              >
                <Text
                  style={[
                    styles.subjectBadgeText,
                    { color: subjectBadge.text },
                  ]}
                >
                  {digest.barSubjectCode.replace(/_/g, ' ')}
                </Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.title}>{digest.title}</Text>

          <ContentDisclaimer contentClass={digest.sourceOrigin} />

          <View style={styles.metaRow}>
            {digest.confidenceScore !== null ? (
              <View style={styles.confidenceContainer}>
                <Text style={styles.metaLabel}>Confidence</Text>
                <Text
                  style={[
                    styles.confidenceValue,
                    { color: getConfidenceColor(digest.confidenceScore) },
                  ]}
                >
                  {Math.round(digest.confidenceScore * 100)}%
                </Text>
              </View>
            ) : null}
            <View>
              <Text style={styles.metaLabel}>Source</Text>
              <Text style={styles.metaValue}>
                {digest.sourceOrigin.replace(/_/g, ' ')}
              </Text>
            </View>
            <View>
              <Text style={styles.metaLabel}>Created</Text>
              <Text style={styles.metaValue}>
                {new Date(digest.createdAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </Text>
            </View>
          </View>

          {digest.legalDocumentId ? (
            <TouchableOpacity
              style={styles.sourceLink}
              onPress={() =>
                router.push(`/reader/${digest.legalDocumentId}`)
              }
            >
              <Ionicons name="document-outline" size={16} color="#1a56db" />
              <Text style={styles.sourceLinkText}>View Source Document</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.sectionsContainer}>
          <DigestSection label="Facts" content={digest.facts} />
          <DigestSection label="Issues" content={digest.issues} />
          <DigestSection label="Ruling" content={digest.ruling} />
          <DigestSection label="Doctrine" content={digest.doctrine} />
          <DigestSection label="Dispositive Portion" content={digest.dispositive} />

          {hasIrac ? (
            <IracSection
              issue={digest.iracIssue}
              rule={digest.iracRule}
              application={digest.iracApplication}
              conclusion={digest.iracConclusion}
            />
          ) : null}

          {hasMcq ? (
            <McqSection
              stem={digest.mcqStem!}
              choices={[
                digest.mcqChoiceA,
                digest.mcqChoiceB,
                digest.mcqChoiceC,
                digest.mcqChoiceD,
              ]}
              correctChoice={digest.mcqCorrectChoice}
              explanation={digest.mcqExplanation}
            />
          ) : null}

          {hasEssay ? (
            <View>
              <DigestSection label="Essay Prompt" content={digest.essayPrompt} />
              {digest.essayModelAnswer ? (
                <CollapsibleSection
                  title="Model Answer (ALAC)"
                  icon="school-outline"
                  iconColor="#1d4ed8"
                >
                  <Text style={styles.essayAnswer}>{digest.essayModelAnswer}</Text>
                </CollapsibleSection>
              ) : null}
            </View>
          ) : null}

          {hasOutline ? (
            <OutlineSection outline={digest.subjectOutlineJson!} />
          ) : null}
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  content: { paddingBottom: 40 },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  errorState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#fff',
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
    marginTop: 12,
  },
  backButton: {
    marginTop: 16,
    backgroundColor: '#1a56db',
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  backButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  header: {
    backgroundColor: '#fff',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    gap: 10,
  },
  badges: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  typeBadge: {
    backgroundColor: '#eff6ff',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  typeBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1d4ed8',
    textTransform: 'capitalize',
  },
  statusBadge: {
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  visibilityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f3f4f6',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  visibilityText: {
    fontSize: 12,
    color: '#6b7280',
    textTransform: 'capitalize',
  },
  subjectBadge: {
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  subjectBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    lineHeight: 26,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 20,
  },
  metaLabel: {
    fontSize: 11,
    color: '#9ca3af',
    fontWeight: '500',
    marginBottom: 2,
  },
  metaValue: {
    fontSize: 13,
    color: '#374151',
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  confidenceContainer: {},
  confidenceValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  sourceLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#1a56db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  sourceLinkText: { fontSize: 13, color: '#1a56db', fontWeight: '600' },
  sectionsContainer: { padding: 16, gap: 12 },
  digestSection: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1a56db',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  sectionContent: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 22,
  },
  // Collapsible sections
  collapsibleSection: {
    backgroundColor: '#fff',
    borderRadius: 10,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  collapsibleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 8,
  },
  collapsibleTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  collapsibleBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  // IRAC
  iracItem: {
    marginBottom: 12,
  },
  iracLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#7c3aed',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  iracText: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 22,
  },
  // MCQ
  mcqStem: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    lineHeight: 22,
    marginBottom: 12,
  },
  mcqChoice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginBottom: 8,
    gap: 10,
  },
  mcqChoiceCorrect: {
    borderColor: '#059669',
    backgroundColor: '#ecfdf5',
  },
  mcqChoiceWrong: {
    borderColor: '#dc2626',
    backgroundColor: '#fef2f2',
  },
  mcqLetterCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mcqLetterCorrect: {
    backgroundColor: '#059669',
  },
  mcqLetterWrong: {
    backgroundColor: '#dc2626',
  },
  mcqLetter: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
  },
  mcqLetterTextCorrect: {
    color: '#fff',
  },
  mcqLetterTextWrong: {
    color: '#fff',
  },
  mcqChoiceText: {
    flex: 1,
    fontSize: 14,
    color: '#374151',
    lineHeight: 21,
    marginTop: 3,
  },
  mcqExplanation: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#fef3c7',
    borderRadius: 8,
    padding: 12,
    marginTop: 4,
  },
  mcqExplanationText: {
    flex: 1,
    fontSize: 13,
    color: '#92400e',
    lineHeight: 20,
  },
  mcqResetButton: {
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#d1d5db',
    marginTop: 8,
  },
  mcqResetText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6b7280',
  },
  // Essay
  essayAnswer: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 22,
  },
  // Outline
  outlineText: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 22,
    marginBottom: 2,
  },
  outlineHeading: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
    marginTop: 4,
  },
});

import { useMemo } from 'react';
import { ActivityIndicator, Alert, Share, Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import {
  DigestDetailScreen,
  type DigestBadge,
  type DigestSection,
} from '@/components/screens/DigestDetailScreen';
import { AudioPlayerBar } from '@/features/audio/components/AudioPlayerBar';
import { useDigest } from '@/features/digests/hooks/use-digests';
import { ContentDisclaimer } from '@/features/documents/components/content-disclaimer';
import { ExportButton } from '@/features/exports/components/export-button';
import { useTheme } from '@/providers/theme-provider';
import type { Digest } from '@/features/digests/types';

// API enum: ['case_digest','statute_summary','reviewer_note','study_digest']
// see apps/api/src/modules/digests/dto/generate-digest.dto.ts:14
const DIGEST_TYPE_LABELS: Record<string, string> = {
  case_digest: 'Case digest',
  statute_summary: 'Statute summary',
  reviewer_note: 'Reviewer note',
  study_digest: 'Study digest',
};

const REVIEW_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  ai_generated: 'AI generated',
  needs_human_review: 'Needs review',
  approved: 'Approved',
  rejected: 'Rejected',
};

// API enum: ['official_pipeline','admin_generated','user_scan','user_upload','camera_capture']
// see apps/api/src/modules/digests/dto/create-digest.dto.ts:26
const SOURCE_LABELS: Record<string, string> = {
  official_pipeline: 'Official source',
  admin_generated: 'Admin generated',
  user_scan: 'User scan',
  user_upload: 'User upload',
  camera_capture: 'Camera capture',
};

function eyebrowFor(digest: Digest): string {
  return DIGEST_TYPE_LABELS[digest.digestType] ?? digest.digestType.replace(/_/g, ' ');
}

function paragraphsFromBlock(block: string | null): string[] {
  if (!block) return [];
  return block
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function buildCaseDigestSections(digest: Digest): DigestSection[] {
  const candidates: Array<[string, string, string | null]> = [
    ['facts', 'Facts', digest.facts],
    ['petitioner', "Petitioner's arguments", digest.petitionerArguments],
    ['respondent', "Respondent's arguments", digest.respondentArguments],
    ['issues', 'Issues', digest.issues],
    ['ruling', 'Ruling', digest.ruling],
    ['doctrine', 'Doctrine', digest.doctrine],
    ['dispositive', 'Dispositive', digest.dispositive],
  ];
  return candidates
    .map(([id, heading, body]) => ({ id, heading, paragraphs: paragraphsFromBlock(body) }))
    .filter((s) => s.paragraphs.length > 0);
}

function buildBadges(digest: Digest): DigestBadge[] {
  const badges: DigestBadge[] = [];

  // Review status — trust calibration
  if (digest.reviewStatus) {
    const label = REVIEW_STATUS_LABELS[digest.reviewStatus] ?? digest.reviewStatus.replace(/_/g, ' ');
    const tone: DigestBadge['tone'] =
      digest.reviewStatus === 'approved'
        ? 'success'
        : digest.reviewStatus === 'needs_human_review' || digest.reviewStatus === 'ai_generated'
          ? 'warn'
          : 'info';
    badges.push({ label, tone });
  }

  // Visibility — multi-tenancy / scope signal
  if (digest.visibility) {
    const tone: DigestBadge['tone'] = digest.visibility === 'private' ? 'private' : 'info';
    badges.push({
      label: digest.visibility.replace(/_/g, ' '),
      tone,
    });
  }

  // Source origin
  if (digest.sourceOrigin) {
    const label = SOURCE_LABELS[digest.sourceOrigin] ?? digest.sourceOrigin.replace(/_/g, ' ');
    const tone: DigestBadge['tone'] =
      digest.sourceOrigin === 'official_pipeline' ? 'success' : 'info';
    badges.push({ label, tone });
  }

  // Confidence — required by CLAUDE.md domain rules for AI output trust calibration
  if (typeof digest.confidenceScore === 'number') {
    const pct = Math.round(digest.confidenceScore * 100);
    const tone: DigestBadge['tone'] =
      digest.confidenceScore >= 0.85 ? 'success' : digest.confidenceScore >= 0.7 ? 'info' : 'warn';
    badges.push({ label: `Confidence ${pct}%`, tone });
  }

  return badges;
}

function disclaimerClassFor(digest: Digest): string | null {
  // Map digest signals to ContentDisclaimer classes per CLAUDE.md provenance rules.
  if (digest.sourceOrigin === 'official_pipeline' && digest.reviewStatus === 'approved') {
    return 'official_text';
  }
  if (digest.visibility === 'private') return 'user_private';
  if (
    digest.reviewStatus === 'ai_generated'
    || digest.reviewStatus === 'needs_human_review'
    || digest.reviewStatus === 'draft'
  ) {
    return 'ai_generated';
  }
  return null;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function DigestDetailRoute() {
  const { theme } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const digestId = id ?? '';

  const { data: digest, isLoading, error } = useDigest(digestId);

  const sections = useMemo(
    () => (digest ? buildCaseDigestSections(digest) : []),
    [digest],
  );
  const badges = useMemo(() => (digest ? buildBadges(digest) : []), [digest]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg }}>
        <ActivityIndicator size="large" color={theme.ink} />
      </View>
    );
  }

  if (error || !digest) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg, paddingHorizontal: 32 }}>
        <Text style={{ fontFamily: theme.serif, fontSize: 22, color: theme.ink, marginBottom: 8 }}>
          Digest not found
        </Text>
        <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: theme.inkSoft, textAlign: 'center' }}>
          The digest you&apos;re looking for could not be loaded.
        </Text>
      </View>
    );
  }

  const handleShare = async () => {
    try {
      await Share.share({
        title: digest.title,
        message: digest.summary
          ? `${digest.title}\n\n${digest.summary}`
          : digest.title,
      });
    } catch {
      // User cancelled or share unavailable — silent.
    }
  };

  const handleSourcePress = () => {
    if (digest.legalDocumentId) {
      router.push(`/reader/${digest.legalDocumentId}`);
    } else {
      Alert.alert('No source', 'This digest has no linked source document.');
    }
  };

  const disclaimerClass = disclaimerClassFor(digest);
  const disclaimerSlot = disclaimerClass ? <ContentDisclaimer contentClass={disclaimerClass} /> : null;

  // Footer: timestamps + ExportButton. ExportButton owns its own sheet trigger,
  // so we render it directly rather than fronting it with a top-action stub.
  const footerSlot = (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: theme.inkSoft }}>
        Created {formatTimestamp(digest.createdAt)}
      </Text>
      {digest.updatedAt && digest.updatedAt !== digest.createdAt ? (
        <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: theme.inkSoft }}>
          · Updated {formatTimestamp(digest.updatedAt)}
        </Text>
      ) : null}
      <View style={{ marginLeft: 'auto' }}>
        <ExportButton
          contentType="digest"
          contentId={digest.id}
          title={digest.title}
          color={theme.ink}
          size={20}
        />
      </View>
    </View>
  );

  return (
    <DigestDetailScreen
      eyebrow={eyebrowFor(digest)}
      headline={digest.title}
      tldr={digest.summary ?? undefined}
      sections={sections}
      badges={badges}
      disclaimerSlot={disclaimerSlot}
      playerSlot={
        <AudioPlayerBar contentType="digest" contentId={digest.id} title={digest.title} />
      }
      footerSlot={footerSlot}
      onBack={() => router.back()}
      onShare={handleShare}
      onCTAPress={handleSourcePress}
      onBookmark={() => Alert.alert('Bookmark', 'Bookmarking digests is coming in the next release.')}
      onMore={() => Alert.alert('More', 'More actions coming soon.')}
    />
  );
}

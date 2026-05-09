import { useMemo } from 'react';
import { ActivityIndicator, Alert, Share, Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { DigestDetailScreen } from '@/components/screens/DigestDetailScreen';
import { useDigest } from '@/features/digests/hooks/use-digests';
import { useTheme } from '@/providers/theme-provider';
import type { DigestSection } from '@/components/screens/DigestDetailScreen';
import type { Digest } from '@/features/digests/types';

const DIGEST_TYPE_LABELS: Record<string, string> = {
  case_digest: 'Case digest',
  irac: 'IRAC digest',
  mcq: 'MCQ',
  essay: 'Essay',
  outline: 'Outline',
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

function buildSections(digest: Digest): DigestSection[] {
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

export default function DigestDetailRoute() {
  const { theme } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const digestId = id ?? '';

  const { data: digest, isLoading, error } = useDigest(digestId);

  const sections = useMemo(() => (digest ? buildSections(digest) : []), [digest]);

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

  return (
    <DigestDetailScreen
      eyebrow={eyebrowFor(digest)}
      headline={digest.title}
      tldr={digest.summary ?? undefined}
      sections={sections}
      onBack={() => router.back()}
      onShare={handleShare}
      onCTAPress={handleSourcePress}
      onBookmark={() => Alert.alert('Bookmark', 'Bookmarking digests is coming in the next release.')}
      onMore={() => Alert.alert('More', 'More actions coming soon.')}
    />
  );
}

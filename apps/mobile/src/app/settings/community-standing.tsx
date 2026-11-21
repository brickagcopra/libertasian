import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  APPEAL_MAX_CHARS,
  APPEAL_MIN_CHARS,
  useCommunityStanding,
  useFileAppeal,
  type StandingDecision,
} from '@/features/community-guidelines/use-community-standing';
import { useTheme } from '@/providers/theme-provider';

const REASON_LABELS: Record<string, string> = {
  spam: 'Spam',
  harassment: 'Harassment or bullying',
  hate_speech: 'Hate speech or slurs',
  sexual_content: 'Sexual content',
  violence_or_self_harm: 'Violence or self-harm',
  misinformation: 'Misinformation',
  copyright: 'Copyright',
  off_topic: 'Off-topic',
  other: 'Other',
};

const TARGET_LABELS: Record<string, string> = {
  post: 'post',
  comment: 'comment',
  flashcard_set: 'flashcard set',
  reviewer_pack: 'reviewer pack',
  digest: 'digest',
  community_rating: 'review',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function decisionTitle(d: StandingDecision): string {
  if (d.action === 'ban') return 'Banned from the community';
  if (d.action === 'suspend') return 'Community access suspended';
  const what = TARGET_LABELS[d.targetType] ?? 'content';
  return `Your ${what} was removed`;
}

function statusLine(d: StandingDecision): string {
  if (d.appeal?.status === 'open') return 'Appeal under review';
  if (d.appeal?.status === 'granted') return 'Appeal granted: decision reversed';
  if (d.appeal?.status === 'denied') return 'Appeal reviewed: decision upheld';
  if (!d.inEffect) return 'No longer in effect';
  if (d.action === 'suspend' && d.endsAt) return `Until ${formatDate(d.endsAt)}`;
  return d.canAppeal ? `You can appeal until ${formatDate(d.appealDeadline)}` : 'Appeal window closed';
}

function DecisionCard({ item }: { item: StandingDecision }) {
  const { theme } = useTheme();
  const fileAppeal = useFileAppeal();
  const [open, setOpen] = useState(false);
  const [statement, setStatement] = useState('');
  const trimmed = statement.trim();
  const tooShort = trimmed.length < APPEAL_MIN_CHARS;

  const submit = () => {
    fileAppeal.mutate(
      { decisionId: item.id, statement: trimmed },
      {
        onSuccess: () => {
          setOpen(false);
          setStatement('');
          Alert.alert('Appeal sent', 'A moderator will review it and let you know the outcome.');
        },
        onError: (err) =>
          Alert.alert(
            "Couldn't send your appeal",
            err instanceof Error && err.message ? err.message : 'Please try again.',
          ),
      },
    );
  };

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: theme.line,
        borderRadius: 12,
        padding: 14,
        marginBottom: 12,
        gap: 6,
      }}
    >
      <Text style={{ color: theme.ink, fontSize: 15, fontWeight: '600' }}>
        {decisionTitle(item)}
      </Text>
      <Text style={{ color: theme.inkSoft, fontSize: 13 }}>
        {formatDate(item.createdAt)}
        {item.reason ? ` · ${REASON_LABELS[item.reason] ?? item.reason}` : ''}
      </Text>
      {item.preview ? (
        <Text style={{ color: theme.ink, fontSize: 14, lineHeight: 20 }} numberOfLines={3}>
          “{item.preview}”
        </Text>
      ) : null}
      <Text style={{ color: theme.inkSoft, fontSize: 13 }}>{statusLine(item)}</Text>
      {item.appeal?.decisionNote ? (
        <Text style={{ color: theme.inkSoft, fontSize: 13, fontStyle: 'italic' }}>
          Moderator note: {item.appeal.decisionNote}
        </Text>
      ) : null}

      {item.canAppeal && !open ? (
        <TouchableOpacity
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Appeal this decision"
          style={{ alignSelf: 'flex-start', paddingVertical: 6 }}
        >
          <Text style={{ color: theme.ink, fontSize: 15, fontWeight: '600' }}>Appeal</Text>
        </TouchableOpacity>
      ) : null}

      {open ? (
        <View style={{ gap: 8, marginTop: 4 }}>
          <Text style={{ color: theme.inkSoft, fontSize: 13, lineHeight: 19 }}>
            Tell the moderators why you think this decision was a mistake. You can appeal each
            decision once.
          </Text>
          <TextInput
            value={statement}
            onChangeText={setStatement}
            multiline
            maxLength={APPEAL_MAX_CHARS}
            placeholder="Your appeal"
            placeholderTextColor={theme.inkSoft}
            accessibilityLabel="Your appeal"
            style={{
              minHeight: 96,
              borderWidth: 1,
              borderColor: theme.line,
              borderRadius: 8,
              padding: 10,
              color: theme.ink,
              fontSize: 15,
              textAlignVertical: 'top',
            }}
          />
          <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
            <TouchableOpacity
              onPress={submit}
              disabled={tooShort || fileAppeal.isPending}
              accessibilityRole="button"
              accessibilityLabel="Send appeal"
              accessibilityState={{ disabled: tooShort || fileAppeal.isPending }}
              style={{ paddingVertical: 6, opacity: tooShort || fileAppeal.isPending ? 0.4 : 1 }}
            >
              <Text style={{ color: theme.ink, fontSize: 15, fontWeight: '600' }}>
                {fileAppeal.isPending ? 'Sending…' : 'Send appeal'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setOpen(false)}
              disabled={fileAppeal.isPending}
              accessibilityRole="button"
              style={{ paddingVertical: 6 }}
            >
              <Text style={{ color: theme.inkSoft, fontSize: 15 }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );
}

export default function CommunityStandingScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { data, isLoading, error, refetch, isRefetching } = useCommunityStanding();

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.ink} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <FlatList
        data={data ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <DecisionCard item={item} />}
        onRefresh={() => void refetch()}
        refreshing={isRefetching}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, flexGrow: 1 }}
        ListHeaderComponent={
          (data?.length ?? 0) > 0 ? (
            <Text style={{ color: theme.inkSoft, fontSize: 13, lineHeight: 19, marginBottom: 16 }}>
              Moderator decisions about your community activity. If you think one was a mistake,
              you can appeal it within 30 days.
            </Text>
          ) : null
        }
        ListEmptyComponent={
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 24 }}>
            <Ionicons
              name={error ? 'alert-circle-outline' : 'shield-checkmark-outline'}
              size={32}
              color={theme.inkSoft}
            />
            <Text style={{ color: theme.ink, fontSize: 16, fontWeight: '600', textAlign: 'center' }}>
              {error ? "Couldn't load your community standing" : "You're in good standing"}
            </Text>
            <Text style={{ color: theme.inkSoft, fontSize: 13, lineHeight: 19, textAlign: 'center' }}>
              {error
                ? 'Pull down to try again.'
                : 'No moderator has removed your content or restricted your account.'}
            </Text>
          </View>
        }
      />
    </View>
  );
}

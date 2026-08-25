import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Input } from '@/components/ui/Input';
import { useTheme } from '@/providers/theme-provider';
import { ChatMessage } from '../../chat/components/ChatMessage';
import { useDocumentChat, type ChatTurn } from '../hooks/use-document-chat';
import { dedupeSources, formatAnswerText } from '../format-answer-text';
import { SourceCard } from './source-card';

interface DocumentChatSheetProps {
  visible: boolean;
  onClose: () => void;
  documentId: string;
  documentTitle?: string;
}

/**
 * Ask-this-document assistant, scoped to the document open in the reader.
 *
 * Distinct from the rule-based FAQ widget at `/help`: that one answers product
 * questions from a bundled knowledge base and is left untouched. This one is
 * grounded retrieval over one document, and every claim it makes carries source
 * cards from that document.
 */
export function DocumentChatSheet({
  visible,
  onClose,
  documentId,
  documentTitle,
}: DocumentChatSheetProps) {
  const { theme } = useTheme();
  const [input, setInput] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  const { turns, isStreaming, atLimit, quota, send } = useDocumentChat(documentId);

  useEffect(() => {
    if (turns.length > 0) {
      scrollRef.current?.scrollToEnd({ animated: true });
    }
  }, [turns]);

  const canSend = input.trim().length > 0 && !isStreaming && !atLimit;

  const handleSend = useCallback(() => {
    if (!canSend) return;
    const text = input;
    setInput('');
    void send(text);
  }, [canSend, input, send]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.avoider}
        >
          <View style={[styles.sheet, { backgroundColor: theme.bg }]}>
            <View style={styles.header}>
              <View style={styles.headerText}>
                <Text
                  style={[styles.title, { fontFamily: theme.serif, color: theme.ink }]}
                  numberOfLines={1}
                >
                  Ask this document
                </Text>
                {documentTitle ? (
                  <Text style={[styles.subtitle, { color: theme.inkSoft }]} numberOfLines={1}>
                    {documentTitle}
                  </Text>
                ) : null}
              </View>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close"
                style={styles.close}
              >
                <Ionicons name="close" size={22} color={theme.inkSoft} />
              </Pressable>
            </View>

            <QuotaLine quota={quota} inkSoft={theme.inkSoft} />

            <ScrollView
              ref={scrollRef}
              style={styles.transcript}
              contentContainerStyle={styles.transcriptContent}
              keyboardShouldPersistTaps="handled"
            >
              {turns.length === 0 ? (
                <Text style={[styles.empty, { color: theme.inkSoft }]}>
                  Ask a question about this document. Answers are drawn only from its
                  text, with the passages they came from.
                </Text>
              ) : null}

              {turns.map((turn) => (
                <TurnView key={turn.id} turn={turn} isStreaming={isStreaming} />
              ))}
            </ScrollView>

            {atLimit ? (
              /*
               * Neutral by construction. Apple 3.1.1 and Play Payments forbid
               * steering users to buy, so this names no tier, shows no price,
               * and offers no link — the same rule `gated-notice.tsx` states and
               * the bar-exam accordion follows. The server's 403 message is
               * discarded upstream for exactly this reason.
               */
              <Text style={[styles.atLimit, { color: theme.inkSoft }]}>
                You&apos;ve reached your AI answer limit for now. Try again later.
              </Text>
            ) : (
              <View style={styles.composer}>
                <Input
                  containerStyle={styles.input}
                  value={input}
                  onChangeText={setInput}
                  placeholder="Ask about this document"
                  returnKeyType="send"
                  onSubmitEditing={handleSend}
                  editable={!isStreaming}
                />
                <Pressable
                  onPress={handleSend}
                  disabled={!canSend}
                  accessibilityRole="button"
                  accessibilityLabel="Send"
                  accessibilityState={{ disabled: !canSend }}
                  style={[
                    styles.send,
                    { backgroundColor: canSend ? theme.pillBg : theme.surfaceMuted },
                  ]}
                >
                  {isStreaming ? (
                    <ActivityIndicator size="small" color={theme.inkSoft} />
                  ) : (
                    <Ionicons
                      name="arrow-up"
                      size={20}
                      color={canSend ? theme.pillInk : theme.inkFaint}
                    />
                  )}
                </Pressable>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function QuotaLine({
  quota,
  inkSoft,
}: {
  quota: ReturnType<typeof useDocumentChat>['quota'];
  inkSoft: string;
}) {
  // Nothing to show on an uncapped plan, and nothing to show before the quota
  // query resolves — a flickering "0 / 0" reads as a broken limit.
  if (!quota || quota.unlimited) return null;
  return (
    <Text style={[styles.quota, { color: inkSoft }]}>
      {quota.remaining} of {quota.limit} AI answers left this month
    </Text>
  );
}

function TurnView({ turn, isStreaming }: { turn: ChatTurn; isStreaming: boolean }) {
  const { theme } = useTheme();

  if (turn.role === 'user') {
    return <ChatMessage message={{ id: turn.id, role: 'user', text: turn.text }} />;
  }

  if (turn.status === 'error') {
    return (
      <Text style={[styles.turnNotice, { color: theme.inkSoft }]}>
        {turn.errorKind === 'auth'
          ? 'Your session expired. Sign in again to continue.'
          : turn.errorKind === 'quota'
            ? // Neutral: see the at-limit note above.
              'You’ve reached your AI answer limit for now. Try again later.'
            : 'That answer could not be completed. Try again.'}
      </Text>
    );
  }

  if (turn.abstained) {
    return (
      <View style={[styles.abstention, { backgroundColor: theme.surfaceMuted }]}>
        <Ionicons name="shield-outline" size={16} color={theme.inkSoft} />
        <Text style={[styles.abstentionText, { color: theme.inkSoft }]}>
          Not enough grounding in this document to answer that.
        </Text>
      </View>
    );
  }

  const waiting = turn.status === 'streaming' && turn.text.length === 0;

  // Deduped once and shared: `formatAnswerText` numbers `[n]` against this
  // exact list, so the inline markers and the source rows cannot drift apart.
  const citedSources = dedupeSources(turn.sources);
  const answerText = formatAnswerText(turn.text, turn.sources);

  return (
    <View style={styles.answer}>
      {waiting ? (
        <View style={styles.thinking} accessibilityRole="progressbar">
          <ActivityIndicator size="small" color={theme.inkSoft} />
          <Text style={[styles.thinkingText, { color: theme.inkSoft }]}>
            Reading this document…
          </Text>
        </View>
      ) : (
        <ChatMessage message={{ id: turn.id, role: 'bot', text: answerText }} />
      )}

      {citedSources.length > 0 ? (
        <View style={styles.sources}>
          <Text style={[styles.sourcesTitle, { color: theme.inkSoft }]}>
            Sources ({citedSources.length})
          </Text>
          {citedSources.map((source, i) => (
            <SourceCard
              key={`${source.document_id}:${source.section_id ?? i}`}
              source={source}
              index={i}
            />
          ))}
        </View>
      ) : null}

      {/* Streaming turns get no source list until metadata lands, so the
          absence above is expected mid-stream rather than a missing citation. */}
      {turn.status === 'complete' && turn.sources.length === 0 && !isStreaming ? (
        <Text style={[styles.turnNotice, { color: theme.inkSoft }]}>
          No source passages were returned for this answer.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  avoider: { justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 28,
    maxHeight: '86%',
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  headerText: { flex: 1 },
  title: { fontSize: 24, letterSpacing: -0.5 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 2 },
  close: { padding: 4 },
  quota: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 8 },
  transcript: { marginTop: 14 },
  transcriptContent: { gap: 12, paddingBottom: 8 },
  empty: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21 },
  answer: { gap: 8 },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  thinkingText: { fontFamily: 'Inter_400Regular', fontSize: 13 },
  sources: { gap: 8, marginTop: 2 },
  sourcesTitle: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  abstention: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 10 },
  abstentionText: { fontFamily: 'Inter_400Regular', fontSize: 13, flex: 1, lineHeight: 19 },
  turnNotice: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  atLimit: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, marginTop: 14 },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  input: { flex: 1 },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});

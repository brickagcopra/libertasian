import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Chip } from '@/components/ui/Chip';
import { Input } from '@/components/ui/Input';
import { useTheme } from '@/providers/theme-provider';
import { FAQ_ENTRIES, matchFaq } from '../chat-knowledge-base';
import { ChatMessage, type ChatMessageData } from './ChatMessage';

// TODO: wire to content.footer.contactEmail (server-only today). Keep in sync
// with apps/web/src/components/chat/chat-widget.tsx.
const SUPPORT_EMAIL = 'info.libertasian@gmail.com';

export const FALLBACK_ANSWER = `I'm not sure about that one yet — our team can help: ${SUPPORT_EMAIL}.`;

const GREETING =
  "Hi! I'm the LIBERTASIAN assistant. Ask me about search, digests, privacy, usage limits, and more — or pick a topic below.";

// Topics surfaced as quick-reply chips, in display order. The chip label is the
// entry's `question`, so this list is what decides which topics are visible:
// there is deliberately no plans-or-pricing topic to surface (Apple 2.1(b)).
const QUICK_REPLY_IDS = ['what-is', 'usage', 'search', 'bar-exams', 'privacy', 'contact'];

const TYPING_DELAY_MS = 500;

/**
 * Single async boundary for answer resolution.
 *
 * PHASE 2: replace this body with a POST to a future NestJS endpoint that
 * proxies OpenAI's cheapest model server-side — the API key NEVER ships to the
 * client. The signature stays `(input) => Promise<string>` so nothing else in
 * this component changes.
 */
export async function resolveAnswer(input: string): Promise<string> {
  const match = matchFaq(input);
  return match ? match.answer : FALLBACK_ANSWER;
}

const QUICK_REPLIES = QUICK_REPLY_IDS.map((id) =>
  FAQ_ENTRIES.find((entry) => entry.id === id),
).filter((entry): entry is (typeof FAQ_ENTRIES)[number] => entry !== undefined);

/**
 * Phase-1 rule-based FAQ chat — mobile port of the web `ChatWidget`
 * (apps/web/src/components/chat/chat-widget.tsx). Fully client-side: no chat
 * API exists yet; answers come from the bundled FAQ knowledge base.
 */
export function ChatScreen() {
  const { theme } = useTheme();

  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [messages, setMessages] = useState<ChatMessageData[]>([
    { id: 'greeting', role: 'bot', text: GREETING },
  ]);

  const scrollRef = useRef<ScrollView>(null);
  const messageCount = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const nextId = useCallback(() => {
    messageCount.current += 1;
    return `m${messageCount.current}`;
  }, []);

  const scrollToEnd = useCallback(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || isTyping) return;

      setMessages((prev) => [...prev, { id: nextId(), role: 'user', text }]);
      setInput('');
      setIsTyping(true);

      const [answer] = await Promise.all([
        resolveAnswer(text),
        new Promise((resolve) => setTimeout(resolve, TYPING_DELAY_MS)),
      ]);

      if (!mountedRef.current) return;
      setIsTyping(false);
      setMessages((prev) => [...prev, { id: nextId(), role: 'bot', text: answer }]);
    },
    [isTyping, nextId],
  );

  const handleSubmit = useCallback(() => {
    void send(input);
  }, [input, send]);

  const canSend = input.trim().length > 0 && !isTyping;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Messages */}
      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={styles.messages}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={scrollToEnd}
      >
        {messages.map((message) => (
          <ChatMessage key={message.id} message={message} />
        ))}

        {isTyping && <TypingIndicator />}

        {/* Quick replies — only before the user has engaged. */}
        {messages.length === 1 && !isTyping && (
          <View style={styles.quickReplies}>
            {QUICK_REPLIES.map((entry) => (
              <Chip
                key={entry.id}
                label={entry.question}
                onPress={() => void send(entry.question)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {/* Composer */}
      <View
        style={[
          styles.composer,
          { borderTopColor: theme.line, backgroundColor: theme.bg },
        ]}
      >
        <Input
          value={input}
          onChangeText={setInput}
          placeholder="Ask a question…"
          accessibilityLabel="Type your message"
          autoComplete="off"
          returnKeyType="send"
          onSubmitEditing={handleSubmit}
          containerStyle={styles.flex}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send message"
          accessibilityState={{ disabled: !canSend }}
          disabled={!canSend}
          onPress={handleSubmit}
          style={[
            styles.sendButton,
            { backgroundColor: canSend ? theme.pillBg : theme.surfaceMuted },
          ]}
        >
          <Ionicons name="send" size={18} color={canSend ? theme.pillInk : theme.inkFaint} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const DOT_COUNT = 3;
const DOT_STAGGER_MS = 150;

function TypingIndicator() {
  const { theme } = useTheme();
  const dots = useRef(
    Array.from({ length: DOT_COUNT }, () => new Animated.Value(0.3)),
  ).current;

  useEffect(() => {
    const loops = dots.map((dot, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * DOT_STAGGER_MS),
          Animated.timing(dot, {
            toValue: 1,
            duration: 450,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0.3,
            duration: 450,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [dots]);

  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Assistant is typing" style={styles.typingRow}>
      <View style={[styles.typingAvatar, { backgroundColor: theme.accentSoft }]}>
        <Ionicons name="sparkles" size={14} color={theme.ink} />
      </View>
      <View
        style={[
          styles.typingBubble,
          { backgroundColor: theme.surface, borderColor: theme.line },
        ]}
      >
        {dots.map((dot, index) => (
          <Animated.View
            // Fixed-length list; index key is stable.
            key={index}
            style={[styles.typingDot, { backgroundColor: theme.inkFaint, opacity: dot }]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  messages: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 12,
  },
  quickReplies: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 4,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 24,
    borderTopWidth: 1,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typingRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  typingAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  typingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});

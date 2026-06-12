'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type Variants,
} from 'framer-motion';
import { MessageCircle, Send, Sparkles, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { motionTokens } from '@/lib/motion';

import { ChatMessage, type ChatMessageData } from './chat-message';
import { FAQ_ENTRIES, matchFaq } from './chat-knowledge-base';

// TODO: wire to content.footer.contactEmail (server-only today). Keep in sync
// with apps/web/src/features/homepage/server/homepage-content.ts.
const SUPPORT_EMAIL = 'info.libertasian@gmail.com';

const FALLBACK_ANSWER = `I'm not sure about that one yet — our team can help: ${SUPPORT_EMAIL}.`;

const GREETING =
  "Hi! I'm the LIBERTASIAN assistant. Ask me about search, pricing, digests, privacy, and more — or pick a topic below.";

// Topics surfaced as quick-reply chips, in display order.
const QUICK_REPLY_IDS = ['what-is', 'pricing', 'search', 'bar-exams', 'privacy', 'contact'];

const SESSION_KEY = 'lib-chat-open';
const TYPING_DELAY_MS = 500;

/**
 * Single async boundary for answer resolution.
 *
 * PHASE 2: replace this body with a POST to a future NestJS endpoint that
 * proxies OpenAI's cheapest model server-side — the API key NEVER ships to the
 * browser, and CSP `connect-src 'self'` keeps the call same-origin. The signature
 * stays `(input) => Promise<string>` so nothing else in this component changes.
 */
async function resolveAnswer(input: string): Promise<string> {
  const match = matchFaq(input);
  return match ? match.answer : FALLBACK_ANSWER;
}

const panelVariants: Variants = {
  hidden: { opacity: 0, scale: 0.92, y: 16 },
  visible: { opacity: 1, scale: 1, y: 0 },
};

const panelVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

export function ChatWidget() {
  const pathname = usePathname();
  const prefersReducedMotion = useReducedMotion() ?? false;

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [messages, setMessages] = useState<ChatMessageData[]>([
    { id: 'greeting', role: 'bot', text: GREETING },
  ]);

  const launcherRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
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

  // Restore per-tab open/closed state.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(SESSION_KEY) === '1') setOpen(true);
    } catch {
      // sessionStorage may be unavailable (private mode); ignore.
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(SESSION_KEY, open ? '1' : '0');
    } catch {
      // ignore write failures
    }
  }, [open]);

  // Focus the input when the panel opens.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Keep the conversation scrolled to the latest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
  }, [messages, isTyping, prefersReducedMotion]);

  const closePanel = useCallback(() => {
    setOpen(false);
    launcherRef.current?.focus();
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

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void send(input);
    },
    [input, send],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closePanel();
      }
    },
    [closePanel],
  );

  // Hide entirely on admin surfaces.
  if (pathname?.startsWith('/admin')) return null;

  const quickReplies = QUICK_REPLY_IDS.map((id) =>
    FAQ_ENTRIES.find((entry) => entry.id === id),
  ).filter((entry): entry is (typeof FAQ_ENTRIES)[number] => entry !== undefined);

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      <AnimatePresence>
        {open && (
          <motion.div
            key="chat-panel"
            role="dialog"
            aria-label="Support chat"
            aria-modal="false"
            onKeyDown={handleKeyDown}
            variants={prefersReducedMotion ? panelVariantsReduced : panelVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            transition={
              prefersReducedMotion
                ? { duration: motionTokens.duration.fast }
                : { ...motionTokens.easing.spring, duration: motionTokens.duration.base }
            }
            style={{ transformOrigin: 'bottom right' }}
            className="flex h-[min(34rem,calc(100vh-7rem))] w-[min(22rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--warm-line)] bg-[var(--warm-surface)] shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-2 border-b border-[var(--warm-line)] bg-[var(--warm-cream)] px-4 py-3">
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="flex size-8 items-center justify-center rounded-full bg-[var(--warm-accent)] text-white"
                >
                  <Sparkles className="size-4" />
                </span>
                <div className="leading-tight">
                  <p
                    className="text-sm font-semibold text-[var(--warm-ink)]"
                    style={{ fontFamily: 'var(--font-fraunces)' }}
                  >
                    LIBERTASIAN Support
                  </p>
                  <p className="text-xs text-[var(--warm-ink-soft)]">
                    Typically replies instantly
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closePanel}
                aria-label="Close support chat"
                className="flex size-8 items-center justify-center rounded-full text-[var(--warm-ink-soft)] transition-colors hover:bg-[var(--warm-cream-2)] hover:text-[var(--warm-ink)] focus-visible:ring-2 focus-visible:ring-[var(--warm-accent)] focus-visible:outline-none"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Messages */}
            <div
              ref={scrollRef}
              className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
            >
              {messages.map((message) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  reducedMotion={prefersReducedMotion}
                />
              ))}

              <AnimatePresence>
                {isTyping && <TypingIndicator reducedMotion={prefersReducedMotion} />}
              </AnimatePresence>

              {/* Quick replies — only before the user has engaged. */}
              {messages.length === 1 && !isTyping && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {quickReplies.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => void send(entry.question)}
                      className="rounded-full border border-[var(--warm-line)] bg-[var(--warm-surface)] px-3 py-1.5 text-xs font-medium text-[var(--warm-ink-soft)] transition-colors hover:border-[var(--warm-accent)] hover:bg-[var(--warm-accent-soft)] hover:text-[var(--warm-accent-deep)] focus-visible:ring-2 focus-visible:ring-[var(--warm-accent)] focus-visible:outline-none"
                    >
                      {entry.question}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Composer */}
            <form
              onSubmit={handleSubmit}
              className="flex items-center gap-2 border-t border-[var(--warm-line)] bg-[var(--warm-surface)] px-3 py-3"
            >
              <Input
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Ask a question…"
                aria-label="Type your message"
                autoComplete="off"
                className="flex-1 rounded-full"
              />
              <Button
                type="submit"
                size="icon"
                aria-label="Send message"
                disabled={!input.trim() || isTyping}
                className="rounded-full bg-[var(--warm-accent)] text-white hover:bg-[var(--warm-accent-deep)]"
              >
                <Send className="size-4" />
              </Button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Launcher */}
      <AnimatePresence>
        {!open && (
          <motion.button
            key="chat-launcher"
            ref={launcherRef}
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open support chat"
            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
            animate={
              prefersReducedMotion
                ? { opacity: 1 }
                : { opacity: 1, scale: [0.8, 1.08, 1] }
            }
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
            transition={{ duration: motionTokens.duration.base, ease: motionTokens.easing.smooth }}
            whileHover={prefersReducedMotion ? undefined : { scale: 1.05 }}
            whileTap={prefersReducedMotion ? undefined : { scale: 0.95 }}
            className="flex size-14 items-center justify-center rounded-full bg-[var(--warm-accent)] text-white shadow-lg transition-colors hover:bg-[var(--warm-accent-deep)] focus-visible:ring-4 focus-visible:ring-[var(--warm-accent-soft)] focus-visible:outline-none"
          >
            <MessageCircle className="size-6" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

function TypingIndicator({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: motionTokens.duration.fast }}
      className="flex items-center gap-2"
      aria-label="Assistant is typing"
      role="status"
    >
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--warm-accent-soft)] text-[var(--warm-accent-deep)]"
      >
        <Sparkles className="size-4" />
      </span>
      <span className="flex items-center gap-1 rounded-2xl border border-[var(--warm-line)] bg-[var(--warm-cream)] px-3.5 py-3">
        {[0, 1, 2].map((dot) => (
          <motion.span
            key={dot}
            className="block size-1.5 rounded-full bg-[var(--warm-ink-faint)]"
            animate={
              reducedMotion
                ? { opacity: [0.4, 1, 0.4] }
                : { opacity: [0.3, 1, 0.3], y: [0, -3, 0] }
            }
            transition={{
              duration: 0.9,
              repeat: Infinity,
              delay: dot * 0.15,
              ease: 'easeInOut',
            }}
          />
        ))}
      </span>
    </motion.div>
  );
}

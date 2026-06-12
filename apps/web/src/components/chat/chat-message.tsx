'use client';

import { motion, type Variants } from 'framer-motion';
import { Sparkles } from 'lucide-react';

import { motionTokens } from '@/lib/motion';

export type ChatRole = 'bot' | 'user';

export interface ChatMessageData {
  id: string;
  role: ChatRole;
  text: string;
}

const bubbleVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
};

const bubbleVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

interface ChatMessageProps {
  message: ChatMessageData;
  reducedMotion: boolean;
}

export function ChatMessage({ message, reducedMotion }: ChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <motion.div
      variants={reducedMotion ? bubbleVariantsReduced : bubbleVariants}
      initial="hidden"
      animate="visible"
      transition={{ duration: motionTokens.duration.base }}
      className={`flex items-end gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
    >
      {!isUser && (
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--warm-accent-soft)] text-[var(--warm-accent-deep)]"
        >
          <Sparkles className="size-4" />
        </span>
      )}
      <div
        className="max-w-[78%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed"
        style={
          isUser
            ? // accent-deep (not accent) keeps white body text at >=4.5:1 contrast
              { backgroundColor: 'var(--warm-accent-deep)', color: '#ffffff' }
            : {
                backgroundColor: 'var(--warm-cream)',
                color: 'var(--warm-ink)',
                border: '1px solid var(--warm-line)',
              }
        }
      >
        {message.text}
      </div>
    </motion.div>
  );
}

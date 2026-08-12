import { useCallback, useEffect, useRef, useState } from 'react';

import { useQuotaUsage } from '../../billing/hooks/use-quotas';
import type { AiAnswerSource } from '../../search/types';
import {
  streamAiAnswer,
  type AiAnswerTurn,
  type StreamErrorKind,
} from '../stream-ai-answer';

/**
 * Multi-turn assistant scoped to the document currently open in the reader.
 *
 * Each turn costs one `aiAnswers` unit, charged by the gateway BEFORE the first
 * token, so the request only ever fires from an explicit `send()` — never on
 * mount or on a dependency change. Same discipline as
 * `use-bar-exams.ts:57-62`.
 */

/** Matches MAX_HISTORY_TURNS on the gateway DTO and the RAG schema. */
export const MAX_HISTORY_TURNS = 20;

/** The client-side quota key. NB: the server entitlement is named `aiAnswers`. */
const AI_ANSWERS_QUOTA_KEY = 'ai_answers_per_month';

export type ChatTurnStatus = 'streaming' | 'complete' | 'error';

export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  status: ChatTurnStatus;
  sources: AiAnswerSource[];
  abstained: boolean;
  errorKind?: StreamErrorKind;
}

export interface DocumentChatQuota {
  used: number;
  limit: number;
  remaining: number;
  /** True when the plan has no cap — callers should render nothing. */
  unlimited: boolean;
}

export function useDocumentChat(documentId: string) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [atLimit, setAtLimit] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);
  const mountedRef = useRef(true);
  // The in-flight guard is a ref, not the `isStreaming` state, because `send`
  // closes over state from its render. Two taps landing in the same frame would
  // both read `isStreaming === false` and fire two turns — two quota units for
  // one intent.
  const inFlightRef = useRef(false);

  const { data: quotaData, refetch: refetchQuota } = useQuotaUsage();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const nextId = useCallback((role: string) => {
    seqRef.current += 1;
    return `${role}-${seqRef.current}`;
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    inFlightRef.current = false;
    setTurns([]);
    setIsStreaming(false);
    setAtLimit(false);
  }, []);

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || inFlightRef.current) return;
      inFlightRef.current = true;

      // Only completed assistant answers and the questions that produced them
      // are replayed. An errored or abstained turn carries no answer worth
      // continuing from, and sending it would invite the model to treat its own
      // failure as established context.
      const history: AiAnswerTurn[] = turns
        .filter((t) => t.status === 'complete' && !t.abstained && t.text.length > 0)
        .map((t) => ({ role: t.role, content: t.text }))
        .slice(-MAX_HISTORY_TURNS);

      const userTurn: ChatTurn = {
        id: nextId('user'),
        role: 'user',
        text: question,
        status: 'complete',
        sources: [],
        abstained: false,
      };
      const answerId = nextId('assistant');
      const answerTurn: ChatTurn = {
        id: answerId,
        role: 'assistant',
        text: '',
        status: 'streaming',
        sources: [],
        abstained: false,
      };

      setTurns((prev) => [...prev, userTurn, answerTurn]);
      setIsStreaming(true);

      const patch = (fn: (t: ChatTurn) => ChatTurn) => {
        if (!mountedRef.current) return;
        setTurns((prev) => prev.map((t) => (t.id === answerId ? fn(t) : t)));
      };

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      await streamAiAnswer(
        { query: question, documentId, ...(history.length ? { history } : {}) },
        {
          onText: (delta) => patch((t) => ({ ...t, text: t.text + delta })),
          onMetadata: (meta) =>
            patch((t) => ({
              ...t,
              sources: meta.sources ?? t.sources,
              abstained: meta.abstained ?? t.abstained,
            })),
          onDone: (meta) =>
            patch((t) => ({
              ...t,
              status: 'complete',
              sources: meta.sources ?? t.sources,
              abstained: meta.abstained ?? t.abstained,
            })),
          onError: (err) => {
            if (err.kind === 'quota' && mountedRef.current) {
              setAtLimit(true);
            }
            // The server's message is deliberately discarded: it is written for
            // the web app and may name a plan or point at pricing, which is the
            // steering Apple 3.1.1 forbids. The UI writes its own copy from
            // `errorKind`.
            patch((t) => ({ ...t, status: 'error', errorKind: err.kind }));
          },
        },
        controller.signal,
      );

      inFlightRef.current = false;
      if (!mountedRef.current) return;

      setIsStreaming(false);
      // A stream that closed without a `done` frame still has to settle.
      patch((t) => (t.status === 'streaming' ? { ...t, status: 'complete' } : t));
      void refetchQuota();
    },
    [documentId, nextId, refetchQuota, turns],
  );

  const raw = quotaData?.quotas?.[AI_ANSWERS_QUOTA_KEY];
  const quota: DocumentChatQuota | null = raw
    ? {
        used: raw.used,
        limit: raw.limit,
        remaining: raw.remaining,
        unlimited: raw.limit < 0 || raw.limit >= 999999,
      }
    : null;

  return {
    turns,
    isStreaming,
    /** True once the gateway has refused a turn for quota. */
    atLimit: atLimit || (quota !== null && !quota.unlimited && quota.remaining <= 0),
    quota,
    send,
    reset,
  };
}

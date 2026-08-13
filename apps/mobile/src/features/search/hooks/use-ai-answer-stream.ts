import { useCallback, useEffect, useRef, useState } from 'react';

import { streamAiAnswer } from '../../ai-answers/stream-ai-answer';
import type { AiAnswerSource } from '../types';

/**
 * One-shot AI answer for the search screen, driven by a query string.
 *
 * The SSE transport itself now lives in `features/ai-answers/stream-ai-answer`
 * and is shared with the reader's document chat, so there is a single streaming
 * client rather than one per surface. This hook's public API is unchanged.
 */

interface StreamState {
  text: string;
  sources: AiAnswerSource[];
  isStreaming: boolean;
  isDone: boolean;
  error: string | null;
  confidence: number | null;
  abstained: boolean;
  abstentionReason: string | null;
  retryCount: number;
}

const INITIAL_STATE: StreamState = {
  text: '',
  sources: [],
  isStreaming: false,
  isDone: false,
  error: null,
  confidence: null,
  abstained: false,
  abstentionReason: null,
  retryCount: 0,
};

export function useAiAnswerStream(query: string | null, enabled: boolean) {
  const [state, setState] = useState<StreamState>(INITIAL_STATE);

  const abortRef = useRef<AbortController | null>(null);
  const lastQueryRef = useRef<string | null>(null);

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  useEffect(() => {
    if (!enabled || !query) {
      return;
    }

    if (lastQueryRef.current === query && (state.isDone || state.isStreaming)) {
      return;
    }

    lastQueryRef.current = query;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    void streamAiAnswer(
      { query },
      {
        onAttempt: (attempt) => {
          setState({ ...INITIAL_STATE, isStreaming: true, retryCount: attempt });
        },
        onText: (delta) => {
          setState((prev) => ({ ...prev, text: prev.text + delta }));
        },
        onMetadata: (meta) => {
          setState((prev) => ({
            ...prev,
            sources: meta.sources ?? prev.sources,
            confidence: meta.confidence ?? prev.confidence,
            abstained: meta.abstained ?? prev.abstained,
            abstentionReason: meta.abstentionReason ?? prev.abstentionReason,
          }));
        },
        onDone: (meta) => {
          setState((prev) => ({
            ...prev,
            isStreaming: false,
            isDone: true,
            // A terminal abstention means the text already on screen was found
            // ungrounded after the fact, so it is REPLACED, never appended to.
            // When the server sends no replacement copy the abstention came
            // before generation, and the text we hold IS its abstention text.
            text: meta.abstained && meta.abstentionText ? meta.abstentionText : prev.text,
            sources: meta.sources ?? prev.sources,
            confidence: meta.confidence ?? prev.confidence,
            abstained: meta.abstained ?? prev.abstained,
            abstentionReason: meta.abstentionReason ?? prev.abstentionReason,
          }));
        },
        onError: (err) => {
          setState((prev) => ({ ...prev, isStreaming: false, error: err.message }));
        },
      },
      controller.signal,
    ).then(() => {
      // A stream that closes without a `done` frame still has to settle.
      if (controller.signal.aborted) return;
      setState((prev) => (prev.isStreaming ? { ...prev, isStreaming: false, isDone: true } : prev));
    });

    return () => {
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, enabled]);

  return { ...state, reset };
}

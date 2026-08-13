'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuthStore } from '@/stores/auth-store';
import type { AiAnswerChunk, AiAnswerSource } from '../types';

const API_BASE_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001/api/v1';

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1000;

/** HTTP status codes that should NOT be retried (client errors, auth failures). */
const NON_RETRYABLE_STATUSES = new Set([400, 401, 403, 404, 422]);

function isTransientError(err: unknown): boolean {
  if (err instanceof TypeError) return true; // fetch network failures
  const msg = (err as Error).message ?? '';
  return /network|timeout|econnreset|econnrefused|socket hang up|failed to fetch/i.test(msg);
}

function retryDelay(attempt: number): number {
  // Exponential backoff: 1s, 2s, 4s + jitter (0-500ms)
  const base = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.random() * 500;
  return base + jitter;
}

interface FrameMetadata {
  sources?: AiAnswerSource[];
  confidence?: number;
  abstained?: boolean;
  abstentionReason?: string;
  /**
   * Server-written replacement copy on a terminal abstention. Present only when
   * the answer was already streamed and then found ungrounded.
   */
  abstentionText?: string;
}

/**
 * Flatten one frame's payload.
 *
 * The stream nests everything under `metadata`; the non-streaming
 * `POST /ai-answers` response carries the same values at the top level. Nested
 * is read first with the flat field as fallback, so both shapes parse. Reading
 * only the flat fields — as this did — meant sources, confidence and the whole
 * abstention signal were undefined on every streamed answer, so the Sources
 * panel and the confidence badge never rendered and PR #372's post-generation
 * abstention never fired.
 */
function readFrameMetadata(chunk: AiAnswerChunk): FrameMetadata {
  const nested = chunk.metadata;
  return {
    sources: nested?.sources ?? chunk.sources,
    confidence: nested?.confidence ?? chunk.confidence,
    abstained: nested?.abstained ?? chunk.abstained,
    abstentionReason: nested?.abstention_reason ?? chunk.abstention_reason,
    abstentionText: nested?.abstention_text,
  };
}

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

export function useAiAnswerStream(query: string | null, enabled: boolean) {
  const [state, setState] = useState<StreamState>({
    text: '',
    sources: [],
    isStreaming: false,
    isDone: false,
    error: null,
    confidence: null,
    abstained: false,
    abstentionReason: null,
    retryCount: 0,
  });

  const abortRef = useRef<AbortController | null>(null);
  const lastQueryRef = useRef<string | null>(null);

  const reset = useCallback(() => {
    setState({
      text: '',
      sources: [],
      isStreaming: false,
      isDone: false,
      error: null,
      confidence: null,
      abstained: false,
      abstentionReason: null,
      retryCount: 0,
    });
  }, []);

  useEffect(() => {
    if (!enabled || !query) {
      return;
    }

    // Avoid re-fetching for the same query
    if (lastQueryRef.current === query && (state.isDone || state.isStreaming)) {
      return;
    }

    lastQueryRef.current = query;

    // Abort any existing stream
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const startStream = async (attempt = 0) => {
      setState({
        text: '',
        sources: [],
        isStreaming: true,
        isDone: false,
        error: null,
        confidence: null,
        abstained: false,
        abstentionReason: null,
        retryCount: attempt,
      });

      try {
        const token = useAuthStore.getState().accessToken;
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(`${API_BASE_URL}/ai-answers/stream`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ query }),
          signal: controller.signal,
        });

        if (response.status === 401) {
          setState((prev) => ({
            ...prev,
            isStreaming: false,
            error: 'Session expired. Please log in again.',
          }));
          return;
        }

        if (response.status === 403) {
          const errorBody = await response.json().catch(() => ({})) as Record<string, unknown>;
          setState((prev) => ({
            ...prev,
            isStreaming: false,
            error: (errorBody['message'] as string) ?? 'AI answer quota exceeded',
          }));
          return;
        }

        if (!response.ok || !response.body) {
          // Retry on server errors (5xx)
          if (!NON_RETRYABLE_STATUSES.has(response.status) && attempt < MAX_RETRIES) {
            const delay = retryDelay(attempt);
            await new Promise((resolve) => setTimeout(resolve, delay));
            if (!controller.signal.aborted) {
              return startStream(attempt + 1);
            }
            return;
          }
          setState((prev) => ({
            ...prev,
            isStreaming: false,
            error: `Request failed with status ${response.status}`,
          }));
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE lines
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;

            try {
              const chunk = JSON.parse(jsonStr) as AiAnswerChunk;

              if (chunk.type === 'text' && chunk.content) {
                setState((prev) => ({
                  ...prev,
                  text: prev.text + chunk.content,
                }));
              } else if (chunk.type === 'metadata') {
                const meta = readFrameMetadata(chunk);
                setState((prev) => ({
                  ...prev,
                  sources: meta.sources ?? prev.sources,
                  confidence: meta.confidence ?? prev.confidence,
                  abstained: meta.abstained ?? prev.abstained,
                  abstentionReason: meta.abstentionReason ?? prev.abstentionReason,
                }));
              } else if (chunk.type === 'done') {
                const meta = readFrameMetadata(chunk);
                setState((prev) => ({
                  ...prev,
                  isStreaming: false,
                  isDone: true,
                  // A terminal abstention means the text already on screen was
                  // found ungrounded after the fact, so it is REPLACED, never
                  // appended to. With no replacement copy the abstention came
                  // before generation and the text we hold IS its abstention
                  // text.
                  text: meta.abstained && meta.abstentionText ? meta.abstentionText : prev.text,
                  sources: meta.sources ?? prev.sources,
                  confidence: meta.confidence ?? prev.confidence,
                  abstained: meta.abstained ?? prev.abstained,
                  abstentionReason: meta.abstentionReason ?? prev.abstentionReason,
                }));
              } else if (chunk.type === 'error') {
                setState((prev) => ({
                  ...prev,
                  isStreaming: false,
                  error: chunk.message ?? 'Stream error',
                }));
              }
            } catch {
              // Skip unparseable chunks
            }
          }
        }

        // If stream ends without a 'done' chunk, mark as done
        setState((prev) => {
          if (prev.isStreaming) {
            return { ...prev, isStreaming: false, isDone: true };
          }
          return prev;
        });
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;

        // Retry transient network errors
        if (isTransientError(err) && attempt < MAX_RETRIES && !controller.signal.aborted) {
          const delay = retryDelay(attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
          if (!controller.signal.aborted) {
            return startStream(attempt + 1);
          }
          return;
        }

        setState((prev) => ({
          ...prev,
          isStreaming: false,
          error: (err as Error).message ?? 'Stream failed',
        }));
      }
    };

    startStream();

    return () => {
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, enabled]);

  return { ...state, reset };
}

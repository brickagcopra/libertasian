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
                setState((prev) => ({
                  ...prev,
                  sources: chunk.sources ?? prev.sources,
                  confidence: chunk.confidence ?? prev.confidence,
                  abstained: chunk.abstained ?? prev.abstained,
                  abstentionReason: chunk.abstention_reason ?? prev.abstentionReason,
                }));
              } else if (chunk.type === 'done') {
                setState((prev) => ({
                  ...prev,
                  isStreaming: false,
                  isDone: true,
                  sources: chunk.sources ?? prev.sources,
                  confidence: chunk.confidence ?? prev.confidence,
                  abstained: chunk.abstained ?? prev.abstained,
                  abstentionReason: chunk.abstention_reason ?? prev.abstentionReason,
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

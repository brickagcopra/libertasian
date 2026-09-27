'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { quotaKeys } from '@/features/billing/hooks/use-quotas';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';

import { resolveHttpError } from '../lib/api';
import { SseFrameParser } from '../lib/sse';
import { initialStreamState, streamReducer } from '../lib/stream-reducer';
import { deepResearchKeys } from './use-deep-research-runs';

const API_BASE_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001/api/v1';

function post(question: string, token: string | null, signal: AbortSignal) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(`${API_BASE_URL}/deep-research/stream`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ question }),
    signal,
  });
}

/**
 * Streams one Deep Research run from POST /deep-research/stream.
 *
 * Same transport as the search page's AI answer (`useAiAnswerStream`): a
 * bearer-authenticated `fetch` whose body is read as SSE. Two deliberate
 * differences: a 401 gets ONE silent refresh + retry (nothing was charged —
 * the guards run before the quota), and nothing else is ever retried, because
 * a run that reached the stream has already spent a monthly unit.
 */
export function useDeepResearchStream() {
  const [state, dispatch] = useReducer(streamReducer, initialStreamState);
  const queryClient = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);

  const refreshAfterRun = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: deepResearchKeys.list() });
    void queryClient.invalidateQueries({ queryKey: quotaKeys.usage() });
  }, [queryClient]);

  const start = useCallback(
    async (question: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      // Frames from a superseded stream must not reach the new run's state.
      const live = () => abortRef.current === controller && !controller.signal.aborted;

      dispatch({ type: 'start', question });

      try {
        let response = await post(question, useAuthStore.getState().accessToken, controller.signal);
        if (response.status === 401) {
          const fresh = await apiClient.refresh();
          if (fresh && live()) response = await post(question, fresh, controller.signal);
        }
        if (!live()) return;

        if (!response.ok || !response.body) {
          const body: unknown = await response.json().catch(() => null);
          if (!live()) return;
          dispatch({ type: 'fail', error: resolveHttpError(response.status, body) });
          if (response.status === 429) refreshAfterRun();
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const parser = new SseFrameParser();
        const emit = (chunk: string) => {
          for (const frame of parser.push(chunk)) {
            dispatch({ type: 'event', event: frame.event, data: frame.data });
          }
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (!live()) {
            void reader.cancel().catch(() => undefined);
            return;
          }
          if (done) break;
          emit(decoder.decode(value, { stream: true }));
        }
        emit(decoder.decode());
        for (const frame of parser.flush()) {
          dispatch({ type: 'event', event: frame.event, data: frame.data });
        }
        dispatch({ type: 'end' });
        refreshAfterRun();
      } catch (err) {
        if ((err as Error).name === 'AbortError' || !live()) return;
        dispatch({
          type: 'fail',
          error: {
            code: 'internal',
            message: 'The connection was interrupted. Your run may still appear in history.',
          },
        });
        refreshAfterRun();
      }
    },
    [refreshAfterRun],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: 'reset' });
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { state, start, reset };
}

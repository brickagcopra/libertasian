import Constants from 'expo-constants';

import { authStorage } from '../../storage/auth-storage';
import type { AiAnswerChunk, AiAnswerSource } from '../search/types';

/**
 * The single AI-answer streaming client.
 *
 * Extracted from `features/search/hooks/use-ai-answer-stream.ts` so the reader's
 * document chat and the search summary share one transport instead of two
 * copies of SSE framing, retry policy and abort handling drifting apart.
 * `useAiAnswerStream` is now a thin wrapper over this and keeps its previous
 * public API exactly.
 *
 * Deliberately framework-free: no React, no state. Callers own their own state
 * shape, which is what lets a one-shot summary and a multi-turn transcript sit
 * on the same wire code.
 */

function resolveApiBaseUrl(): string {
  const override = process.env['EXPO_PUBLIC_API_URL'];
  if (override) {
    return override;
  }
  return (
    (Constants.expoConfig?.extra?.['apiUrl'] as string | undefined) ??
    'http://localhost:3001/api/v1'
  );
}

const API_BASE_URL = resolveApiBaseUrl();

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1000;

const NON_RETRYABLE_STATUSES = new Set([400, 401, 403, 404, 422]);

function isTransientError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const msg = (err as Error).message ?? '';
  return /network|timeout|econnreset|econnrefused|socket hang up|failed to fetch/i.test(msg);
}

function retryDelay(attempt: number): number {
  const base = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.random() * 500;
  return base + jitter;
}

export interface AiAnswerTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface StreamAiAnswerRequest {
  query: string;
  /** Restrict retrieval to one document. Authorized server-side. */
  documentId?: string;
  /** Prior turns, oldest first. Prompt continuity only — never retrieval. */
  history?: AiAnswerTurn[];
}

export interface StreamMetadata {
  sources?: AiAnswerSource[];
  confidence?: number;
  abstained?: boolean;
  abstentionReason?: string;
}

/**
 * Why the stream stopped, as a discriminant rather than a string.
 *
 * `quota` carries the server's payload but callers are expected to write their
 * own copy from it. Apple 3.1.1 and Play Payments forbid steering, and the
 * server message is written for the web app and may name a plan — the same
 * reasoning as `reader/[id].tsx:445` and `gated-notice.tsx`.
 */
export type StreamErrorKind = 'auth' | 'quota' | 'stream';

export interface StreamError {
  kind: StreamErrorKind;
  /** Server-supplied text. Safe to log; NOT safe to render for `quota`. */
  message: string;
  quota?: { used?: number; limit?: number; resetsAt?: string };
}

export interface StreamAiAnswerHandlers {
  onAttempt?: (attempt: number) => void;
  onText?: (delta: string) => void;
  onMetadata?: (meta: StreamMetadata) => void;
  onDone?: (meta: StreamMetadata) => void;
  onError?: (err: StreamError) => void;
}

function toMetadata(chunk: AiAnswerChunk): StreamMetadata {
  const meta: StreamMetadata = {};
  if (chunk.sources !== undefined) meta.sources = chunk.sources;
  if (chunk.confidence !== undefined) meta.confidence = chunk.confidence;
  if (chunk.abstained !== undefined) meta.abstained = chunk.abstained;
  if (chunk.abstention_reason !== undefined) meta.abstentionReason = chunk.abstention_reason;
  return meta;
}

/**
 * POST to /ai-answers/stream and drive `handlers` from the SSE frames.
 *
 * Resolves when the stream ends, is aborted, or fails terminally. Never
 * rejects: terminal failures arrive through `onError` so callers do not need a
 * second error path. An abort is silent, matching the previous behaviour.
 */
export async function streamAiAnswer(
  request: StreamAiAnswerRequest,
  handlers: StreamAiAnswerHandlers,
  signal: AbortSignal,
  attempt = 0,
): Promise<void> {
  handlers.onAttempt?.(attempt);

  try {
    const token = await authStorage.getAccessToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE_URL}/ai-answers/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: request.query,
        ...(request.documentId ? { documentId: request.documentId } : {}),
        ...(request.history?.length ? { history: request.history } : {}),
      }),
      signal,
    });

    if (response.status === 401) {
      handlers.onError?.({ kind: 'auth', message: 'Session expired. Please log in again.' });
      return;
    }

    if (response.status === 403) {
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      handlers.onError?.({
        kind: 'quota',
        message: (body['message'] as string) ?? 'AI answer quota exceeded',
        quota: body['quota'] as StreamError['quota'],
      });
      return;
    }

    if (!response.ok || !response.body) {
      if (!NON_RETRYABLE_STATUSES.has(response.status) && attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay(attempt)));
        if (signal.aborted) return;
        return streamAiAnswer(request, handlers, signal, attempt + 1);
      }
      handlers.onError?.({
        kind: 'stream',
        message: `Request failed with status ${response.status}`,
      });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;

        try {
          const chunk = JSON.parse(jsonStr) as AiAnswerChunk;

          if (chunk.type === 'text' && chunk.content) {
            handlers.onText?.(chunk.content);
          } else if (chunk.type === 'metadata') {
            handlers.onMetadata?.(toMetadata(chunk));
          } else if (chunk.type === 'done') {
            handlers.onDone?.(toMetadata(chunk));
          } else if (chunk.type === 'error') {
            handlers.onError?.({ kind: 'stream', message: chunk.message ?? 'Stream error' });
          }
        } catch {
          // Skip unparseable chunks
        }
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;

    if (isTransientError(err) && attempt < MAX_RETRIES && !signal.aborted) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay(attempt)));
      if (signal.aborted) return;
      return streamAiAnswer(request, handlers, signal, attempt + 1);
    }

    handlers.onError?.({ kind: 'stream', message: (err as Error).message ?? 'Stream failed' });
  }
}

import Constants from 'expo-constants';
import { fetch as expoFetch } from 'expo/fetch';

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
 *
 * The transport is `expo/fetch`, NOT the React Native global. RN's `fetch` is
 * whatwg-fetch over XMLHttpRequest, so `response.body` is ALWAYS undefined and
 * there is no incremental read to be had — every request fell into the
 * `!response.body` branch and surfaced as "Request failed with status 201", so
 * AI answers never once worked on device. `expo/fetch` is WinterCG-compliant,
 * returns a real `ReadableStream<Uint8Array>`, honours `signal`, and ships
 * inside the `expo` package (no native rebuild). `TextDecoder` comes from the
 * same winter runtime and accepts the Uint8Array chunks directly.
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

/**
 * Allow-list, deliberately — not a deny-list of "known bad" statuses.
 *
 * The stream endpoint calls `UsageQuotaService.checkAndIncrement` before it
 * writes a byte, so every attempt costs the user a quota unit whether or not it
 * produces an answer. Under the old deny-list any status not explicitly named
 * (including a plain 201) retried 3× with backoff: four calls, four units burnt
 * on one failed answer. Only statuses that a retry can actually fix belong here.
 */
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

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
 * Parse one SSE line and drive the matching handler.
 *
 * Shared by the streaming reader loop and the buffered fallback so a
 * non-progressive answer is framed by exactly the same rules as a streamed one.
 * Non-`data:` lines (comments, blank separators) and unparseable payloads are
 * skipped silently, as SSE requires.
 */
function dispatchLine(line: string, handlers: StreamAiAnswerHandlers): void {
  if (!line.startsWith('data: ')) return;
  const jsonStr = line.slice(6).trim();
  if (!jsonStr) return;

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

    const response = await expoFetch(`${API_BASE_URL}/ai-answers/stream`, {
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

    // A bad status and a missing body are different failures and must not share
    // a branch: the first is the server refusing, the second is a transport that
    // could not give us an incremental reader. Collapsing them is what made a
    // successful 201 read as "Request failed with status 201".
    if (!response.ok) {
      if (RETRYABLE_STATUSES.has(response.status) && attempt < MAX_RETRIES) {
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

    // Non-streaming fallback. The response is good, we just cannot read it
    // progressively — buffer the whole payload and run it through the same
    // frame parser. An answer that arrives all at once beats an error.
    if (!response.body) {
      const text = await response.text();
      for (const line of text.split('\n')) {
        dispatchLine(line, handlers);
        if (signal.aborted) return;
      }
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
        dispatchLine(line, handlers);
      }
    }

    // Flush a trailing frame the server did not terminate with a newline.
    if (buffer) dispatchLine(buffer, handlers);
  } catch (err) {
    // expo/fetch does not reliably raise a DOMException named 'AbortError' — an
    // aborted native stream can surface as a plain Error with a native message.
    // The signal itself is the authority, so check it first: aborting on query
    // change or navigation must never show an error or spend another quota unit
    // on a retry.
    if (signal.aborted || (err as Error).name === 'AbortError') return;

    if (isTransientError(err) && attempt < MAX_RETRIES && !signal.aborted) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay(attempt)));
      if (signal.aborted) return;
      return streamAiAnswer(request, handlers, signal, attempt + 1);
    }

    handlers.onError?.({ kind: 'stream', message: (err as Error).message ?? 'Stream failed' });
  }
}

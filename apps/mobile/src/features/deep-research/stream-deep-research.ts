import { fetch as expoFetch } from 'expo/fetch';

import { apiClient } from '../../lib/api-client';
import { authStorage } from '../../storage/auth-storage';
import { resolveApiBaseUrl } from '../ai-answers/stream-ai-answer';
import { parseDeepResearchEvent, type DeepResearchEvent } from './types';

/**
 * POST /deep-research/stream over `expo/fetch`.
 *
 * `expo/fetch`, not the RN global: RN's fetch is whatwg-fetch over XHR and has
 * no `response.body`, so it can never read a stream incrementally. Same
 * reasoning, same transport as `features/ai-answers/stream-ai-answer.ts`.
 *
 * NO RETRIES, deliberately — stricter than the AI-answer client. The controller
 * spends the monthly unit (`checkAndIncrement`) before it writes a byte, and a
 * run the client walked away from still runs to completion server-side and
 * lands in history. A retry is a second run and a second unit. The one
 * exception is the 401 refresh-and-resend, which never reached the quota.
 *
 * Every outcome — including the HTTP refusals that happen BEFORE the stream
 * opens (402 subscription_required, 429 quota_exceeded) — is delivered as an
 * `error` event with the contract's `code`, so the caller has exactly one
 * failure path. The HTTP body's `error` field is overwritten by the global
 * exception filter, so the refusal is read off `code`, never `error`.
 */

const API_BASE_URL = resolveApiBaseUrl();

/** One SSE frame: the `event:` name and the joined `data:` lines. */
export interface SseFrame {
  event: string;
  data: string;
}

/**
 * Incremental SSE framing. Network chunks ignore frame boundaries, so the
 * buffer is carried across `push` calls and only frames whose terminating blank
 * line has arrived are returned. CRLF and LF are both accepted; comment lines
 * are skipped; a frame with no `event:` line is `message`.
 */
export class SseFrameBuffer {
  private buffer = '';

  push(chunk: string): SseFrame[] {
    this.buffer += chunk.replace(/\r\n?/g, '\n');
    const frames: SseFrame[] = [];
    let boundary = this.buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = SseFrameBuffer.parse(this.buffer.slice(0, boundary));
      this.buffer = this.buffer.slice(boundary + 2);
      if (frame) frames.push(frame);
      boundary = this.buffer.indexOf('\n\n');
    }
    return frames;
  }

  /** A trailing frame the server closed without terminating. */
  flush(): SseFrame[] {
    const raw = this.buffer;
    this.buffer = '';
    const frame = raw.trim() ? SseFrameBuffer.parse(raw) : null;
    return frame ? [frame] : [];
  }

  private static parse(raw: string): SseFrame | null {
    let event = 'message';
    const data: string[] = [];
    for (const line of raw.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    return data.length > 0 ? { event, data: data.join('\n') } : null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Map an HTTP refusal to the contract's error event.
 *
 * Branches on the body's `code` — the exception filter rewrites `error`, so
 * `code` is the only field that survives. The 429 from the hourly `@Throttle`
 * backstop carries no `quota_exceeded` code and is NOT a monthly exhaustion:
 * showing it a reset date would be a lie, so it maps to `internal`.
 */
export function refusalToEvent(status: number, body: unknown): DeepResearchEvent {
  const code = isRecord(body) ? body['code'] : undefined;
  const message = isRecord(body) && typeof body['message'] === 'string' ? body['message'] : '';

  if (status === 402 || code === 'subscription_required') {
    return { type: 'error', data: { code: 'subscription_required', message } };
  }
  if (status === 429 && code === 'quota_exceeded') {
    const resetAt = isRecord(body) && typeof body['resetAt'] === 'string' ? body['resetAt'] : undefined;
    return {
      type: 'error',
      data: { code: 'quota_exceeded', message, ...(resetAt ? { resetAt } : {}) },
    };
  }
  if (status === 429) {
    return {
      type: 'error',
      data: { code: 'internal', message: 'Too many runs in a short time. Try again later.' },
    };
  }
  return {
    type: 'error',
    data: { code: 'internal', message: `Request failed with status ${status}` },
  };
}

export interface StreamDeepResearchRequest {
  question: string;
}

/**
 * Stream one Deep Research run, delivering validated events to `onEvent`.
 *
 * Resolves when the stream ends, is aborted, or fails. Never rejects. A stream
 * that closes without a terminal `done` or `error` gets a synthetic `internal`
 * error, so the caller is never left in a "streaming" state forever. An abort
 * is silent.
 */
export async function streamDeepResearch(
  request: StreamDeepResearchRequest,
  onEvent: (event: DeepResearchEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  let terminal = false;
  const emit = (event: DeepResearchEvent) => {
    if (signal.aborted) return;
    if (event.type === 'done' || event.type === 'error') {
      if (terminal) return; // one terminal event per run
      terminal = true;
    }
    onEvent(event);
  };
  const emitFrames = (frames: SseFrame[]) => {
    for (const frame of frames) {
      const event = parseDeepResearchEvent(frame.event, frame.data);
      if (event) emit(event);
    }
  };

  try {
    const body = JSON.stringify({ question: request.question });
    // Token read at call time so the post-refresh resend carries the new one.
    const send = async () => {
      const token = await authStorage.getAccessToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      return expoFetch(`${API_BASE_URL}/deep-research/stream`, {
        method: 'POST',
        headers,
        body,
        signal,
      });
    };

    let response = await send();

    // Refresh through apiClient ONLY: refresh tokens are single-use with reuse
    // detection, so an independent refresh here would race the client's own.
    if (response.status === 401) {
      const refreshed = await apiClient.attemptRefresh();
      if (signal.aborted) return;
      if (refreshed) {
        response = await send();
        if (signal.aborted) return;
      }
      if (!refreshed || response.status === 401) {
        apiClient.notifyUnauthorized();
        emit({
          type: 'error',
          data: { code: 'internal', message: 'Session expired. Please sign in again.' },
        });
        return;
      }
    }

    if (!response.ok) {
      const errorBody: unknown = await response.json().catch(() => null);
      emit(refusalToEvent(response.status, errorBody));
      return;
    }

    const frames = new SseFrameBuffer();

    if (!response.body) {
      // Buffered fallback: same framing, all at once.
      const text = await response.text();
      emitFrames(frames.push(text));
      emitFrames(frames.flush());
    } else {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        emitFrames(frames.push(decoder.decode(value, { stream: true })));
        if (signal.aborted) return;
      }
      emitFrames(frames.flush());
    }

    if (!terminal) {
      emit({
        type: 'error',
        data: {
          code: 'internal',
          message: 'The connection closed before the run finished. It may still appear in your history.',
        },
      });
    }
  } catch (err) {
    // expo/fetch may not raise a DOMException named AbortError; the signal is
    // the authority.
    if (signal.aborted || (err as Error).name === 'AbortError') return;
    emit({
      type: 'error',
      data: { code: 'internal', message: (err as Error).message || 'Deep Research failed.' },
    });
  }
}

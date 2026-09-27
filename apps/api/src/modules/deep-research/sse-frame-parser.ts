/** One parsed Server-Sent Events frame. `data` is the joined data lines. */
export interface SseFrame {
  event: string;
  data: string;
}

/**
 * Incremental SSE parser for the rag-service stream.
 *
 * Network chunks do not respect frame boundaries: one read can end mid-line or
 * carry several frames. `push` buffers across chunks and returns only frames
 * whose terminating blank line has arrived; `flush` returns a trailing frame
 * the upstream closed without terminating. CRLF and LF are both accepted.
 * Comment lines (`:`) and unknown fields are ignored per the SSE spec, and a
 * frame with no `event:` line is `message`.
 */
export class SseFrameParser {
  private buffer = '';

  push(chunk: string): SseFrame[] {
    this.buffer += chunk.replace(/\r\n?/g, '\n');
    const frames: SseFrame[] = [];
    let boundary = this.buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const raw = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const frame = SseFrameParser.parse(raw);
      if (frame) frames.push(frame);
      boundary = this.buffer.indexOf('\n\n');
    }
    return frames;
  }

  flush(): SseFrame[] {
    const raw = this.buffer;
    this.buffer = '';
    const frame = raw.trim() ? SseFrameParser.parse(raw) : null;
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
    if (data.length === 0) return null;
    return { event, data: data.join('\n') };
  }
}

/** Serialize one frame for the client. JSON has no raw newlines, so one line. */
export function formatSseFrame(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

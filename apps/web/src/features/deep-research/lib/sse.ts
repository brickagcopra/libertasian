/** One parsed Server-Sent Events frame. `data` is the joined data lines. */
export interface SseFrame {
  event: string;
  data: string;
}

/**
 * Incremental SSE parser (web twin of apps/api's SseFrameParser).
 *
 * Network chunks do not respect frame boundaries: a read can end mid-line or
 * carry several frames. `push` buffers across chunks and returns only frames
 * whose terminating blank line has arrived; `flush` returns a trailing frame
 * the server closed without terminating. CRLF and LF are both accepted,
 * comment lines are skipped and a frame with no `event:` line is `message`.
 */
export class SseFrameParser {
  private buffer = '';

  push(chunk: string): SseFrame[] {
    this.buffer += chunk.replace(/\r\n?/g, '\n');
    const frames: SseFrame[] = [];
    let boundary = this.buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = SseFrameParser.parse(this.buffer.slice(0, boundary));
      this.buffer = this.buffer.slice(boundary + 2);
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

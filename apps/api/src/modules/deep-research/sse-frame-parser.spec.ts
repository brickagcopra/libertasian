import { formatSseFrame, SseFrameParser } from './sse-frame-parser';

describe('SseFrameParser', () => {
  it('buffers frames split across arbitrary chunk boundaries', () => {
    const wire =
      formatSseFrame('stage', { stage: 'planning' }) +
      formatSseFrame('plan', { subQueries: ['a', 'b'] });
    const parser = new SseFrameParser();
    const frames = [];
    for (const ch of wire) frames.push(...parser.push(ch));
    expect(frames).toEqual([
      { event: 'stage', data: '{"stage":"planning"}' },
      { event: 'plan', data: '{"subQueries":["a","b"]}' },
    ]);
  });

  it('accepts CRLF, ignores comments, defaults the event to message', () => {
    const parser = new SseFrameParser();
    expect(parser.push(': keepalive\r\n\r\ndata: {"x":1}\r\n\r\n')).toEqual([
      { event: 'message', data: '{"x":1}' },
    ]);
  });

  it('joins multi-line data and flushes an unterminated trailing frame', () => {
    const parser = new SseFrameParser();
    expect(parser.push('event: result\ndata: {"a":\ndata: 1}')).toEqual([]);
    expect(parser.flush()).toEqual([{ event: 'result', data: '{"a":\n1}' }]);
    expect(parser.flush()).toEqual([]);
  });
});

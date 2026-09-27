import { describe, expect, it } from 'vitest';

import {
  initialStreamState,
  stageProgress,
  streamReducer,
  type StreamAction,
  type StreamState,
} from './stream-reducer';

const ev = (event: string, data: unknown): StreamAction => ({
  type: 'event',
  event,
  data: typeof data === 'string' ? data : JSON.stringify(data),
});

const SOURCE = {
  sourceId: 'S1',
  documentId: 'doc-1',
  sectionId: 'sec-1',
  title: 'People v. Cruz',
  citation: 'G.R. No. 123456',
  grNo: 'G.R. No. 123456',
  court: 'supreme_court',
  date: '2020-01-15',
  sectionLabel: 'Ruling',
  documentType: 'decision',
};

const RESULT = {
  summary: 'Yes.',
  sections: [
    { heading: 'Rule', claims: [{ text: 'A claim.', citations: [{ sourceId: 'S1', quote: 'q' }] }] },
  ],
  removedClaims: 2,
  abstained: false,
};

const DONE = {
  runId: 'run-1',
  modelName: 'm',
  promptTemplateVersion: 'v1',
  latencyMs: 1000,
  costUsd: 0.01,
};

function run(actions: StreamAction[], from: StreamState = initialStreamState): StreamState {
  return actions.reduce(streamReducer, from);
}

const started = run([{ type: 'start', question: 'Q?' }]);

describe('streamReducer — every event', () => {
  it('start resets to a streaming run with the question', () => {
    expect(started.status).toBe('streaming');
    expect(started.question).toBe('Q?');
    expect(started.stageIndex).toBe(-1);
  });

  it('stage advances the stepper and records detail', () => {
    const s = run([ev('stage', { stage: 'searching', detail: '4 queries' })], started);
    expect(s.stageIndex).toBe(1);
    expect(s.stageDetail.searching).toBe('4 queries');
  });

  it('plan stores the sub-queries', () => {
    const s = run([ev('plan', { subQueries: ['a', 'b'] })], started);
    expect(s.subQueries).toEqual(['a', 'b']);
  });

  it('sources stores the source list', () => {
    const s = run([ev('sources', { sources: [SOURCE] })], started);
    expect(s.sources).toHaveLength(1);
    expect(s.sources[0]?.title).toBe('People v. Cruz');
  });

  it('result stores the parsed answer', () => {
    const s = run([ev('result', RESULT)], started);
    expect(s.result?.removedClaims).toBe(2);
    expect(s.result?.sections[0]?.claims[0]?.citations[0]?.sourceId).toBe('S1');
  });

  it('done finishes the run and completes the stepper', () => {
    const s = run([ev('result', RESULT), ev('done', DONE)], started);
    expect(s.status).toBe('done');
    expect(s.done?.runId).toBe('run-1');
    expect(stageProgress(s).every((p) => p.state === 'complete')).toBe(true);
  });

  it('error ends the run with its code', () => {
    const s = run([ev('error', { code: 'budget_exhausted', message: 'later' })], started);
    expect(s.status).toBe('error');
    expect(s.error).toEqual({ code: 'budget_exhausted', message: 'later' });
  });

  it('an unknown error code degrades to internal', () => {
    const s = run([ev('error', { code: 'new_thing', message: 'x' })], started);
    expect(s.error?.code).toBe('internal');
  });

  it('fail (HTTP refusal) sets the error', () => {
    const s = run([{ type: 'fail', error: { code: 'quota_exceeded', message: '' } }], started);
    expect(s.status).toBe('error');
    expect(s.error?.code).toBe('quota_exceeded');
  });

  it('reset returns to idle', () => {
    expect(run([{ type: 'reset' }], started)).toEqual(initialStreamState);
  });
});

describe('streamReducer — out-of-order and malformed safety', () => {
  it('ignores a malformed payload and keeps streaming', () => {
    const s = run([ev('stage', '{not json'), ev('plan', { subQueries: 'nope' })], started);
    expect(s).toEqual(started);
  });

  it('ignores an unknown stage value', () => {
    expect(run([ev('stage', { stage: 'dreaming' })], started).stageIndex).toBe(-1);
  });

  it('never moves the stepper backwards', () => {
    const s = run(
      [ev('stage', { stage: 'writing' }), ev('stage', { stage: 'planning' })],
      started,
    );
    expect(s.stageIndex).toBe(3);
  });

  it('marks earlier stages complete and the current one active', () => {
    const s = run([ev('stage', { stage: 'ranking' })], started);
    expect(stageProgress(s).map((p) => p.state)).toEqual([
      'complete',
      'complete',
      'active',
      'pending',
      'pending',
    ]);
  });

  it('accepts plan and sources arriving after later stages', () => {
    const s = run(
      [
        ev('stage', { stage: 'writing' }),
        ev('sources', { sources: [SOURCE] }),
        ev('plan', { subQueries: ['late'] }),
      ],
      started,
    );
    expect(s.subQueries).toEqual(['late']);
    expect(s.sources).toHaveLength(1);
  });

  it('accepts a result that done overtook, but nothing else after done', () => {
    const s = run(
      [ev('done', DONE), ev('result', RESULT), ev('stage', { stage: 'planning' }), ev('error', { code: 'internal', message: 'x' })],
      started,
    );
    expect(s.status).toBe('done');
    expect(s.result?.summary).toBe('Yes.');
    expect(s.error).toBeNull();
  });

  it('error wins over a result already received and is terminal', () => {
    const s = run(
      [ev('result', RESULT), ev('error', { code: 'internal', message: 'x' }), ev('done', DONE)],
      started,
    );
    expect(s.status).toBe('error');
    expect(s.done).toBeNull();
  });

  it('ignores events when no run is in flight (superseded stream)', () => {
    expect(run([ev('result', RESULT)])).toEqual(initialStreamState);
  });

  it('a body that ends without done/error fails, unless a result arrived', () => {
    expect(run([{ type: 'end' }], started).error?.code).toBe('internal');
    const withResult = run([ev('result', RESULT), { type: 'end' }], started);
    expect(withResult.status).toBe('done');
    expect(withResult.error).toBeNull();
  });

  it('end and fail after done change nothing', () => {
    const done = run([ev('result', RESULT), ev('done', DONE)], started);
    expect(run([{ type: 'end' }, { type: 'fail', error: { code: 'internal', message: '' } }], done)).toEqual(done);
  });
});

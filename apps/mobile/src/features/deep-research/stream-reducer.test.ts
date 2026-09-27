import {
  deepResearchReducer,
  fromRunDetail,
  initialRunState,
  stepStatuses,
  type DeepResearchRunState,
  type RunAction,
} from './stream-reducer';
import { parseDeepResearchEvent, type DeepResearchEvent } from './types';

/** Parse a frame exactly as the transport would, failing loudly if rejected. */
function ev(event: string, payload: unknown): RunAction {
  const parsed = parseDeepResearchEvent(event, JSON.stringify(payload));
  if (!parsed) throw new Error(`fixture rejected: ${event}`);
  return { type: 'event', event: parsed };
}

function run(actions: RunAction[]): DeepResearchRunState {
  return actions.reduce(deepResearchReducer, initialRunState);
}

const SOURCES = [
  {
    sourceId: 'S1',
    documentId: 'doc-1',
    sectionId: 'sec-1',
    title: 'People v. Cruz',
    citation: 'G.R. No. 123456',
    grNo: '123456',
    court: 'supreme_court',
    date: '2020-01-15',
    sectionLabel: 'Ruling',
    documentType: 'decision',
  },
];

const RESULT = {
  summary: 'Short answer.',
  sections: [
    {
      heading: 'Rule',
      claims: [{ text: 'A claim.', citations: [{ sourceId: 'S1', quote: 'verbatim' }] }],
    },
  ],
  removedClaims: 2,
  abstained: false,
};

const DONE = {
  runId: 'run-1',
  modelName: 'm',
  promptTemplateVersion: 'v1',
  latencyMs: 1200,
  costUsd: 0.01,
};

describe('deepResearchReducer — the full happy path', () => {
  it('walks stage → plan → sources → result → done', () => {
    const state = run([
      { type: 'start' },
      ev('stage', { stage: 'planning' }),
      ev('plan', { subQueries: ['q1', 'q2'] }),
      ev('stage', { stage: 'searching', detail: '2 queries' }),
      ev('stage', { stage: 'ranking' }),
      ev('sources', { sources: SOURCES }),
      ev('stage', { stage: 'writing' }),
      ev('stage', { stage: 'verifying' }),
      ev('result', RESULT),
      ev('done', DONE),
    ]);

    expect(state.phase).toBe('done');
    expect(state.subQueries).toEqual(['q1', 'q2']);
    expect(state.sources).toHaveLength(1);
    expect(state.result?.removedClaims).toBe(2);
    expect(state.done?.runId).toBe('run-1');
    expect(Object.values(stepStatuses(state))).toEqual([
      'complete',
      'complete',
      'complete',
      'complete',
      'complete',
    ]);
  });

  it('tracks the active stage and its detail while streaming', () => {
    const state = run([
      { type: 'start' },
      ev('stage', { stage: 'planning' }),
      ev('stage', { stage: 'searching', detail: '4 queries' }),
    ]);
    expect(state.phase).toBe('streaming');
    expect(state.stageDetail).toBe('4 queries');
    expect(stepStatuses(state)).toEqual({
      planning: 'complete',
      searching: 'active',
      ranking: 'pending',
      writing: 'pending',
      verifying: 'pending',
    });
  });

  it('never moves a stage backwards', () => {
    const state = run([
      { type: 'start' },
      ev('stage', { stage: 'writing' }),
      ev('stage', { stage: 'planning' }),
    ]);
    expect(state.stage).toBe('writing');
  });

  it('accepts a repeated verifying stage (start, then with a claim count)', () => {
    const state = run([
      { type: 'start' },
      ev('stage', { stage: 'verifying' }),
      ev('stage', { stage: 'verifying', detail: '7 claims' }),
    ]);
    expect(state.stageDetail).toBe('7 claims');
  });
});

describe('deepResearchReducer — errors', () => {
  it.each(['quota_exceeded', 'subscription_required', 'budget_exhausted', 'internal'] as const)(
    'ends the run on error %s and marks the running step failed',
    (code) => {
      const state = run([
        { type: 'start' },
        ev('stage', { stage: 'searching' }),
        ev('error', { code, message: 'nope' }),
      ]);
      expect(state.phase).toBe('error');
      expect(state.error?.code).toBe(code);
      expect(stepStatuses(state).searching).toBe('failed');
    },
  );

  it('classifies an unknown error code as internal instead of dropping it', () => {
    const state = run([{ type: 'start' }, ev('error', { code: 'weird', message: 'x' })]);
    expect(state.error?.code).toBe('internal');
  });

  it('keeps the reset date a quota refusal carries', () => {
    const state = run([
      { type: 'start' },
      ev('error', { code: 'quota_exceeded', message: '', resetAt: '2026-10-01T00:00:00.000Z' }),
    ]);
    expect(state.error?.resetAt).toBe('2026-10-01T00:00:00.000Z');
  });

  it('is terminal: a late frame after done or error changes nothing', () => {
    const errored = run([{ type: 'start' }, ev('error', { code: 'internal', message: 'x' })]);
    expect(deepResearchReducer(errored, ev('result', RESULT))).toBe(errored);

    const done = run([{ type: 'start' }, ev('result', RESULT), ev('done', DONE)]);
    expect(deepResearchReducer(done, ev('error', { code: 'internal', message: 'x' }))).toBe(done);
  });
});

describe('parseDeepResearchEvent — zod gate', () => {
  it('drops unknown events, bad JSON and payloads that fail their schema', () => {
    expect(parseDeepResearchEvent('message', '{}')).toBeNull();
    expect(parseDeepResearchEvent('stage', 'not json')).toBeNull();
    expect(parseDeepResearchEvent('stage', JSON.stringify({ stage: 'dreaming' }))).toBeNull();
    expect(parseDeepResearchEvent('result', JSON.stringify({ summary: 'x' }))).toBeNull();
    expect(parseDeepResearchEvent('done', JSON.stringify({ runId: 1 }))).toBeNull();
  });

  it('keeps a source with a null title rather than dropping the whole list', () => {
    const parsed = parseDeepResearchEvent(
      'sources',
      JSON.stringify({ sources: [{ ...SOURCES[0], title: null, court: null }] }),
    ) as Extract<DeepResearchEvent, { type: 'sources' }> | null;
    expect(parsed?.data.sources[0]?.title).toBe('');
  });

  it('reads an abstained result with its reason', () => {
    const parsed = parseDeepResearchEvent(
      'result',
      JSON.stringify({ summary: '', sections: [], removedClaims: 0, abstained: true, abstainReason: 'no_results' }),
    ) as Extract<DeepResearchEvent, { type: 'result' }> | null;
    expect(parsed?.data.abstained).toBe(true);
    expect(parsed?.data.abstainReason).toBe('no_results');
  });
});

describe('fromRunDetail — a past run renders like a finished stream', () => {
  const base = {
    id: 'run-1',
    question: 'Q?',
    createdAt: '2026-09-01T00:00:00.000Z',
    resultJson: RESULT,
    sourcesJson: SOURCES,
    subQueriesJson: ['q1'],
  };

  it('completed → done with result, sources and sub-queries', () => {
    const state = fromRunDetail({ ...base, status: 'completed' } as never);
    expect(state.phase).toBe('done');
    expect(state.result?.summary).toBe('Short answer.');
    expect(state.sources).toHaveLength(1);
    expect(state.subQueries).toEqual(['q1']);
  });

  it('failed → error, with no result required', () => {
    const state = fromRunDetail({
      ...base,
      status: 'failed',
      resultJson: null,
      sourcesJson: null,
      subQueriesJson: null,
    } as never);
    expect(state.phase).toBe('error');
    expect(state.error?.code).toBe('internal');
    expect(state.sources).toEqual([]);
  });
});

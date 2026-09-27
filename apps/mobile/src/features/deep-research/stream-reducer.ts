import {
  DEEP_RESEARCH_STAGES,
  type DeepResearchDone,
  type DeepResearchErrorCode,
  type DeepResearchEvent,
  type DeepResearchResult,
  type DeepResearchSource,
  type DeepResearchStage,
  type DeepResearchRunDetail,
} from './types';

/**
 * The run view's whole state, as a pure reducer over validated SSE events.
 *
 * Pure so it is tested without a network or a renderer, and so a PAST run
 * (`GET /deep-research/:id`) and a LIVE one render through the same shape —
 * `fromRunDetail` builds the state a finished stream would have ended in.
 */

export type RunPhase = 'idle' | 'streaming' | 'done' | 'error';

export interface RunError {
  code: DeepResearchErrorCode;
  message: string;
  resetAt?: string;
}

export interface DeepResearchRunState {
  phase: RunPhase;
  /** The stage announced last, or null before the first `stage` event. */
  stage: DeepResearchStage | null;
  /** Detail line of the current stage (e.g. "4 queries"). */
  stageDetail: string | null;
  subQueries: string[];
  sources: DeepResearchSource[];
  result: DeepResearchResult | null;
  done: DeepResearchDone | null;
  error: RunError | null;
}

export const initialRunState: DeepResearchRunState = {
  phase: 'idle',
  stage: null,
  stageDetail: null,
  subQueries: [],
  sources: [],
  result: null,
  done: null,
  error: null,
};

export type RunAction =
  | { type: 'start' }
  | { type: 'event'; event: DeepResearchEvent }
  | { type: 'reset' };

export function deepResearchReducer(
  state: DeepResearchRunState,
  action: RunAction,
): DeepResearchRunState {
  switch (action.type) {
    case 'start':
      return { ...initialRunState, phase: 'streaming' };
    case 'reset':
      return initialRunState;
    case 'event':
      return applyEvent(state, action.event);
    default:
      return state;
  }
}

function applyEvent(state: DeepResearchRunState, event: DeepResearchEvent): DeepResearchRunState {
  // A terminal state is final: a late frame must not resurrect a failed run or
  // overwrite a finished one.
  if (state.phase === 'done' || state.phase === 'error') return state;

  switch (event.type) {
    case 'stage':
      // Stages only move forward. The server may announce `verifying` twice
      // (start, then with a claim count); an out-of-order frame is ignored.
      if (state.stage && stageIndex(event.data.stage) < stageIndex(state.stage)) return state;
      return {
        ...state,
        phase: 'streaming',
        stage: event.data.stage,
        stageDetail: event.data.detail ?? null,
      };
    case 'plan':
      return { ...state, phase: 'streaming', subQueries: event.data.subQueries };
    case 'sources':
      return { ...state, phase: 'streaming', sources: event.data.sources };
    case 'result':
      return { ...state, phase: 'streaming', result: event.data };
    case 'done':
      return { ...state, phase: 'done', done: event.data };
    case 'error':
      return {
        ...state,
        phase: 'error',
        error: {
          code: event.data.code,
          message: event.data.message,
          ...(event.data.resetAt ? { resetAt: event.data.resetAt } : {}),
        },
      };
    default:
      return state;
  }
}

export function stageIndex(stage: DeepResearchStage): number {
  return DEEP_RESEARCH_STAGES.indexOf(stage);
}

/**
 * Where each stepper step stands. With the run done, every step is complete;
 * on error, the step that was running is marked failed.
 */
export type StepStatus = 'pending' | 'active' | 'complete' | 'failed';

export function stepStatuses(state: DeepResearchRunState): Record<DeepResearchStage, StepStatus> {
  const current = state.stage ? stageIndex(state.stage) : -1;
  const out = {} as Record<DeepResearchStage, StepStatus>;
  DEEP_RESEARCH_STAGES.forEach((stage, i) => {
    if (state.phase === 'done') out[stage] = 'complete';
    else if (i < current) out[stage] = 'complete';
    else if (i === current) out[stage] = state.phase === 'error' ? 'failed' : 'active';
    else out[stage] = 'pending';
  });
  return out;
}

/** The final state of a persisted run, so history renders like a live one. */
export function fromRunDetail(run: DeepResearchRunDetail): DeepResearchRunState {
  const base: DeepResearchRunState = {
    ...initialRunState,
    subQueries: run.subQueriesJson ?? [],
    sources: run.sourcesJson ?? [],
    result: run.resultJson ?? null,
  };
  if (run.status === 'failed') {
    return {
      ...base,
      phase: 'error',
      error: { code: 'internal', message: 'This run did not finish.' },
    };
  }
  if (run.status === 'running') {
    // Still in flight on another screen/device: show what is known.
    return { ...base, phase: 'streaming', stage: 'planning' };
  }
  return { ...base, phase: 'done', stage: 'verifying' };
}

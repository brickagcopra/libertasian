/**
 * Pure state machine for one Deep Research stream.
 *
 * Every SSE payload is Zod-parsed here; a frame that fails its schema is
 * dropped (the run keeps going) rather than crashing the view. Ordering rules
 * that keep a late or reordered frame from corrupting the screen:
 *
 *  - nothing is applied unless a run is in flight (`streaming`), so frames
 *    from an aborted, superseded stream cannot leak into the next one;
 *  - `error` is terminal and wins over everything, including a `result`
 *    already on screen (the API marks such a run failed and refunds it);
 *  - `done` is terminal for everything except a `result` it overtook;
 *  - the stepper only moves forward: a `stage` older than the current one is
 *    ignored.
 */
import {
  STAGES,
  doneEventSchema,
  errorEventSchema,
  planEventSchema,
  resultSchema,
  sourcesEventSchema,
  stageEventSchema,
  type DeepResearchDone,
  type DeepResearchResult,
  type DeepResearchSource,
  type DeepResearchStage,
} from '../schemas';
import type { DeepResearchError } from './api';

export type StreamStatus = 'idle' | 'streaming' | 'done' | 'error';

export interface StreamState {
  status: StreamStatus;
  question: string | null;
  /** Index into STAGES of the furthest stage announced, -1 before any. */
  stageIndex: number;
  stageDetail: Partial<Record<DeepResearchStage, string>>;
  subQueries: string[];
  sources: DeepResearchSource[];
  result: DeepResearchResult | null;
  done: DeepResearchDone | null;
  error: DeepResearchError | null;
}

export const initialStreamState: StreamState = {
  status: 'idle',
  question: null,
  stageIndex: -1,
  stageDetail: {},
  subQueries: [],
  sources: [],
  result: null,
  done: null,
  error: null,
};

export type StreamAction =
  | { type: 'start'; question: string }
  | { type: 'event'; event: string; data: string }
  | { type: 'fail'; error: DeepResearchError }
  | { type: 'end' }
  | { type: 'reset' };

const ENDED_UNEXPECTEDLY: DeepResearchError = {
  code: 'internal',
  message: 'Deep Research ended unexpectedly. Please try again.',
};

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function applyEvent(state: StreamState, event: string, raw: string): StreamState {
  const payload = parseJson(raw);

  // A result that `done` overtook is still welcome; nothing else is.
  if (state.status === 'done') {
    if (event !== 'result' || state.result) return state;
    const parsed = resultSchema.safeParse(payload);
    return parsed.success ? { ...state, result: parsed.data } : state;
  }
  if (state.status !== 'streaming') return state;

  switch (event) {
    case 'stage': {
      const parsed = stageEventSchema.safeParse(payload);
      if (!parsed.success) return state;
      const index = STAGES.indexOf(parsed.data.stage);
      const stageDetail = parsed.data.detail
        ? { ...state.stageDetail, [parsed.data.stage]: parsed.data.detail }
        : state.stageDetail;
      return { ...state, stageIndex: Math.max(state.stageIndex, index), stageDetail };
    }
    case 'plan': {
      const parsed = planEventSchema.safeParse(payload);
      return parsed.success ? { ...state, subQueries: parsed.data.subQueries } : state;
    }
    case 'sources': {
      const parsed = sourcesEventSchema.safeParse(payload);
      return parsed.success ? { ...state, sources: parsed.data.sources } : state;
    }
    case 'result': {
      const parsed = resultSchema.safeParse(payload);
      return parsed.success ? { ...state, result: parsed.data } : state;
    }
    case 'done': {
      const parsed = doneEventSchema.safeParse(payload);
      if (!parsed.success) return state;
      return {
        ...state,
        status: 'done',
        done: parsed.data,
        stageIndex: STAGES.length - 1,
      };
    }
    case 'error': {
      const parsed = errorEventSchema.safeParse(payload);
      const error: DeepResearchError = parsed.success
        ? { code: parsed.data.code, message: parsed.data.message }
        : ENDED_UNEXPECTEDLY;
      return { ...state, status: 'error', error };
    }
    default:
      return state;
  }
}

export function streamReducer(state: StreamState, action: StreamAction): StreamState {
  switch (action.type) {
    case 'start':
      return { ...initialStreamState, status: 'streaming', question: action.question };
    case 'event':
      return applyEvent(state, action.event, action.data);
    case 'fail':
      if (state.status === 'done' || state.status === 'error') return state;
      return { ...state, status: 'error', error: action.error };
    case 'end':
      // The body closed without `done` or `error`. With a verified result in
      // hand the answer is shown (the API persists it regardless); without
      // one the run failed.
      if (state.status !== 'streaming') return state;
      if (state.result) return { ...state, status: 'done', stageIndex: STAGES.length - 1 };
      return { ...state, status: 'error', error: ENDED_UNEXPECTEDLY };
    case 'reset':
      return initialStreamState;
    default:
      return state;
  }
}

/** Stepper view of the state: which stages are finished and which is live. */
export function stageProgress(state: Pick<StreamState, 'status' | 'stageIndex' | 'result'>) {
  const finished = state.status === 'done' || state.result !== null;
  return STAGES.map((stage, i) => ({
    stage,
    state: (finished || i < state.stageIndex
      ? 'complete'
      : i === state.stageIndex && state.status === 'streaming'
        ? 'active'
        : 'pending') as 'complete' | 'active' | 'pending',
  }));
}

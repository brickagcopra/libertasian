import { useEffect, useReducer, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { quotaKeys } from '../../billing/hooks/use-quotas';
import { streamDeepResearch } from '../stream-deep-research';
import { deepResearchReducer, initialRunState, type DeepResearchRunState } from '../stream-reducer';
import { deepResearchKeys } from './use-deep-research';

/**
 * Run tokens already spent in this JS session.
 *
 * Every POST spends a monthly unit, and a run the client leaves still finishes
 * server-side. So a screen that REMOUNTS with the same token (navigation state
 * restore, a fast back/forward) must not fire a second run: it reports
 * `alreadyStarted` and the screen points at history instead.
 */
const consumedTokens = new Set<string>();

/** Test hook: forget spent tokens between cases. */
export function __resetConsumedRunTokens(): void {
  consumedTokens.clear();
}

export interface DeepResearchStreamHandle {
  state: DeepResearchRunState;
  /** The token was spent by an earlier mount; this mount did not stream. */
  alreadyStarted: boolean;
}

/**
 * Start ONE run for `question` when `token` is set, and stream it into state.
 * Aborts on unmount. Refreshes history and the quota once the run is over,
 * because the server has persisted (and possibly refunded) it by then.
 */
export function useDeepResearchStream(
  question: string,
  token: string | null,
): DeepResearchStreamHandle {
  const [state, dispatch] = useReducer(deepResearchReducer, initialRunState);
  const queryClient = useQueryClient();
  // Decided at FIRST render, before this mount's effect spends the token.
  const [alreadyStarted] = useState(() => token !== null && consumedTokens.has(token));

  useEffect(() => {
    if (!token || !question.trim()) return undefined;
    if (consumedTokens.has(token)) return undefined;
    consumedTokens.add(token);

    const controller = new AbortController();
    dispatch({ type: 'start' });
    void streamDeepResearch(
      { question: question.trim() },
      (event) => {
        dispatch({ type: 'event', event });
        if (event.type === 'done' || event.type === 'error') {
          void queryClient.invalidateQueries({ queryKey: deepResearchKeys.list() });
          void queryClient.invalidateQueries({ queryKey: quotaKeys.usage() });
        }
      },
      controller.signal,
    );
    return () => controller.abort();
  }, [question, token, queryClient]);

  return { state, alreadyStarted };
}

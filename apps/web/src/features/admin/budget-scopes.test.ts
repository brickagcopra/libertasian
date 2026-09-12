import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { BUDGET_SCOPES, BUDGET_SCOPE_LABELS } from './budget-scopes';

/**
 * CI-lock. `apps/api/src/common/constants/budget-scopes.ts` is the single
 * source of truth; the web app cannot import it, so this asserts the
 * mirror has not drifted. A stale mirror would offer the operator a
 * category the API rejects, or hide one it accepts.
 */
const API_SOURCE = resolve(
  __dirname,
  '../../../../api/src/common/constants/budget-scopes.ts',
);

function scopesFromApiSource(): string[] {
  const text = readFileSync(API_SOURCE, 'utf8');
  const block = /export const BUDGET_SCOPES = \[([\s\S]*?)\] as const;/.exec(text);
  if (!block) throw new Error('BUDGET_SCOPES not found in the API source');
  return [...block[1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
}

describe('budget scope mirror', () => {
  it('matches the API source exactly, in order', () => {
    expect([...BUDGET_SCOPES]).toEqual(scopesFromApiSource());
  });

  it('labels every scope', () => {
    for (const scope of BUDGET_SCOPES) {
      expect(BUDGET_SCOPE_LABELS[scope]).toBeTruthy();
    }
    expect(Object.keys(BUDGET_SCOPE_LABELS)).toHaveLength(BUDGET_SCOPES.length);
  });
});

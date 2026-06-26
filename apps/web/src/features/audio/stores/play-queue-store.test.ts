import { beforeEach, describe, expect, it } from 'vitest';

import { usePlayQueueStore } from './play-queue-store';

describe('usePlayQueueStore', () => {
  beforeEach(() => {
    usePlayQueueStore.getState().clear();
  });

  it('setQueue replaces ids, cursor, and filters', () => {
    usePlayQueueStore.getState().setQueue({
      ids: ['a', 'b', 'c'],
      cursor: 'cursor-1',
      filters: { digestType: 'case_digest' },
    });

    const state = usePlayQueueStore.getState();
    expect(state.ids).toEqual(['a', 'b', 'c']);
    expect(state.cursor).toBe('cursor-1');
    expect(state.filters).toEqual({ digestType: 'case_digest' });
  });

  it('setQueue de-dupes ids (cursor pagination can surface an id twice)', () => {
    // An updatedAt-ordered list can repeat an id across page boundaries. Without
    // de-dupe a queue like [a,b,a] makes the chain ping-pong a→b→a→… forever.
    usePlayQueueStore.getState().setQueue({
      ids: ['a', 'b', 'a', 'c', 'b'],
      cursor: 'c1',
      filters: null,
    });

    expect(usePlayQueueStore.getState().ids).toEqual(['a', 'b', 'c']);
    expect(usePlayQueueStore.getState().cursor).toBe('c1');
  });

  it('appendPage appends new ids, de-dupes, and advances the cursor', () => {
    usePlayQueueStore
      .getState()
      .setQueue({ ids: ['a', 'b'], cursor: 'c1', filters: null });

    usePlayQueueStore
      .getState()
      .appendPage({ ids: ['b', 'c', 'd'], cursor: 'c2' });

    const state = usePlayQueueStore.getState();
    expect(state.ids).toEqual(['a', 'b', 'c', 'd']);
    expect(state.cursor).toBe('c2');
  });

  it('appendPage with a null cursor marks the queue exhausted', () => {
    usePlayQueueStore
      .getState()
      .setQueue({ ids: ['a'], cursor: 'c1', filters: null });

    usePlayQueueStore.getState().appendPage({ ids: ['b'], cursor: null });

    expect(usePlayQueueStore.getState().cursor).toBeNull();
    expect(usePlayQueueStore.getState().ids).toEqual(['a', 'b']);
  });

  it('clear resets to an empty queue', () => {
    usePlayQueueStore
      .getState()
      .setQueue({ ids: ['a'], cursor: 'c1', filters: { reviewStatus: 'approved' } });

    usePlayQueueStore.getState().clear();

    const state = usePlayQueueStore.getState();
    expect(state.ids).toEqual([]);
    expect(state.cursor).toBeNull();
    expect(state.filters).toBeNull();
  });
});

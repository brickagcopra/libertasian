'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Reader preference for continuous ("Continue playing") autoplay across digests.
 * Persisted to localStorage so the choice survives reloads and follows the reader
 * from one digest to the next. DEFAULT OFF — the chain only auto-advances when the
 * reader has explicitly opted in. Ephemeral UI preference, hence Zustand (the
 * project's choice for UI state) rather than server state.
 */
interface AutoplayPrefState {
  continueEnabled: boolean;
  setContinueEnabled: (enabled: boolean) => void;
}

export const useAutoplayPrefStore = create<AutoplayPrefState>()(
  persist(
    (set) => ({
      continueEnabled: false,
      setContinueEnabled: (continueEnabled: boolean) => set({ continueEnabled }),
    }),
    {
      name: 'libertasian-audio-autoplay',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

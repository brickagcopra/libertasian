import { Audio } from 'expo-av';

/**
 * Audio session plumbing shared by all players.
 *
 * - `ensureAudioMode` configures the OS audio session once per app run so
 *   narration plays through the iOS silent switch and keeps playing when the
 *   app is backgrounded (paired with `UIBackgroundModes: ["audio"]` in
 *   app.json).
 * - `claimAudioFocus` / `releaseAudioFocus` enforce a single active player:
 *   when one player starts, any previously playing player is paused.
 */

let audioModeConfigured = false;

export async function ensureAudioMode(): Promise<void> {
  if (audioModeConfigured) return;
  audioModeConfigured = true;
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
    });
  } catch {
    // Retry on the next player load rather than permanently failing silent.
    audioModeConfigured = false;
  }
}

export interface AudioFocusHandle {
  /** Pause playback; called when another player claims focus. */
  pause: () => void;
}

let currentHolder: AudioFocusHandle | null = null;

/** Pause whichever player currently holds focus, then take it. */
export function claimAudioFocus(handle: AudioFocusHandle): void {
  if (currentHolder && currentHolder !== handle) {
    currentHolder.pause();
  }
  currentHolder = handle;
}

/** Drop focus if this handle still holds it (called on unload/unmount). */
export function releaseAudioFocus(handle: AudioFocusHandle): void {
  if (currentHolder === handle) {
    currentHolder = null;
  }
}

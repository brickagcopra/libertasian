import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';

import { logger } from '../../../lib/logger';

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
    // Every field is passed explicitly. Omitting `interruptionModeIOS` left
    // expo-av's default of MixWithOthers, which makes the session non-primary
    // — and iOS suspends a non-primary session the moment the app
    // backgrounds, so nothing played behind the Home Screen no matter what
    // UIBackgroundModes said. DoNotMix claims the session as primary, which
    // is what `staysActiveInBackground` actually needs to hold. App Review
    // 2.5.4 rejected build 20 for exactly this.
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
    });
  } catch (err) {
    // A rejected call used to vanish into a bare `catch {}`, so a session that
    // never configured looked identical to one that did. Retry on the next
    // player load, but say so.
    audioModeConfigured = false;
    logger.warn('audio_session_configure_failed', {
      reason: err instanceof Error ? err.message : String(err),
    });
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

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { apiClient } from './api-client';
import { pushTokenStorage } from '../storage/push-token-storage';

/**
 * Foreground presentation: show alert + sound so in-app users still see
 * pushes (v1 behavior).
 */
export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Default',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 250, 250, 250],
  });
}

/**
 * Requests permission and returns the Expo push token for this device, or
 * null when unavailable (simulator, permission denied, unsupported platform).
 */
export async function getPushToken(): Promise<string | null> {
  if (!Device.isDevice) return null;
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;

  await ensureAndroidChannel();

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return null;

  const projectId = Constants.expoConfig?.extra?.['eas']?.projectId as
    | string
    | undefined;
  if (!projectId) return null;

  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  return data;
}

/**
 * Registers this device's push token with the API and remembers it locally
 * for sign-out cleanup. Best-effort: resolves to the token on success, null
 * otherwise.
 */
export async function registerPushToken(): Promise<string | null> {
  try {
    const token = await getPushToken();
    if (!token) return null;

    await apiClient.post('/notifications/push-tokens', {
      token,
      platform: Platform.OS,
    });
    await pushTokenStorage.setToken(token);
    return token;
  } catch {
    // Best-effort — push registration must never break sign-in or app start.
    return null;
  }
}

/**
 * Deletes the remembered push token from the API. Must be called BEFORE
 * clearing auth storage — the DELETE needs a valid Bearer token. Best-effort:
 * never throws.
 */
export async function unregisterPushToken(): Promise<void> {
  try {
    const token = await pushTokenStorage.getToken();
    if (token) {
      await apiClient.delete('/notifications/push-tokens', {
        body: JSON.stringify({ token }),
      });
    }
  } catch {
    // Best-effort — sign-out proceeds even if the API call fails.
  } finally {
    await pushTokenStorage.clearToken().catch(() => {
      // Ignore storage cleanup failures.
    });
  }
}

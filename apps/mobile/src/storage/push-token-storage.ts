import * as SecureStore from 'expo-secure-store';

const PUSH_TOKEN_KEY = 'push_token';

/**
 * Remembers the Expo push token that was last registered with the API so it
 * can be unregistered on sign-out (while the Bearer token is still valid).
 */
export const pushTokenStorage = {
  async getToken(): Promise<string | null> {
    return SecureStore.getItemAsync(PUSH_TOKEN_KEY);
  },

  async setToken(token: string): Promise<void> {
    await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token);
  },

  async clearToken(): Promise<void> {
    await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY);
  },
};
